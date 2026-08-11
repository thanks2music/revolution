/**
 * 同一 URL を N 回実行した観測ログ (JSONL) を比較する。
 *
 * ## 使い方
 *
 * ```bash
 * cd apps/ai-writer
 *
 * # 1. まず実行する (課金あり。1 回 約 $0.10)
 * for i in 1 2 3; do
 *   AI_PROVIDER=openai pnpm debug:mdx --dry-run --log https://example.com/
 * done
 *
 * # 2. 比較する (課金なし)
 * pnpm tsx scripts/compare-runs.ts logs/2026-08-12-example-com-*.jsonl
 *
 * # 正解と突き合わせたうえで「系統的 / 確率的」を判定する
 * pnpm tsx scripts/compare-runs.ts logs/*.jsonl --source https://example.com/
 * ```
 *
 * ## 実行と比較を分けている理由
 *
 * 比較ツールが課金 API を N 回叩く作りにすると、誤起動や `--runs` の打ち間違いが
 * そのままコスト事故になる。**本スクリプトはファイルを読むだけで、API を呼ばない**
 * (`--source` を付けたときに公式サイトの HTML を 1 回 GET するのみ)。
 *
 * @module scripts/compare-runs
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, basename, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });

import {
  compareRuns,
  formatRunComparison,
  describeExtractionFailure,
  extractOccurrences,
  venueLabelsOf,
  type OccurrenceExtraction,
  type RunLog,
} from '../lib/utils/run-comparison';
import { extractSourceTruth, compareWithSource } from '../lib/utils/source-truth-extractor';
import { fetchHtmlOrThrow } from '../lib/utils/fetch-html';
import { readRunLog } from '../lib/utils/read-run-log';

interface Args {
  jsonlPaths: string[];
  sourceUrl?: string;
  sourceHtmlPath?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const jsonlPaths: string[] = [];
  let sourceUrl: string | undefined;
  let sourceHtmlPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') {
      sourceUrl = argv[++i];
    } else if (arg === '--source-html') {
      sourceHtmlPath = argv[++i];
    } else if (!arg.startsWith('-')) {
      jsonlPaths.push(arg);
    }
  }

  return { jsonlPaths, sourceUrl, sourceHtmlPath };
}

/** JSONL を 1 行ずつ読む。壊れた行は握り潰さず件数を報告する。 */
function loadRunLog(path: string): RunLog {
  const { runLog, brokenLineCount } = readRunLog(path);
  if (brokenLineCount > 0) {
    console.warn(`⚠️ ${basename(path)}: ${brokenLineCount} 行を parse できませんでした`);
  }
  return runLog;
}

/**
 * `detail-extraction` の応答から occurrences を取り出す (正解照合用)。
 *
 * ⚠️ 空配列に潰さず `status` 付きで返す。切り捨て・parse 失敗を「会場 0 件」として
 * 扱うと、観測の欠損が系統的失敗に化ける (`run-comparison.ts` の説明を参照)。
 */
function readOccurrences(run: RunLog): OccurrenceExtraction {
  return extractOccurrences(run.records.find((r) => r.stepId === 'detail-extraction'));
}

async function main(): Promise<void> {
  const { jsonlPaths, sourceUrl, sourceHtmlPath } = parseArgs();

  if (jsonlPaths.length === 0) {
    console.error('\n❌ 比較対象の JSONL が指定されていません\n');
    console.log('使用方法:');
    console.log('  pnpm tsx scripts/compare-runs.ts <*.jsonl> [--source <URL>] [--source-html <path>]\n');
    console.log('  --source       公式サイトを 1 回 GET して正解データを作り、合否を判定する');
    console.log('  --source-html  保存済み HTML を正解データに使う (ネットワーク不要)\n');
    process.exit(1);
  }

  const runs = jsonlPaths.map(loadRunLog);

  console.log('='.repeat(80));
  console.log('📊 実行間比較');
  console.log('='.repeat(80));
  console.log();

  // 正解データがあれば、実行ごとの合否を出す。無ければ判定しない
  // (自己一貫性から正しさを推定しない)。
  const passFlags: boolean[] = [];

  if (sourceUrl || sourceHtmlPath) {
    const html = sourceHtmlPath
      ? readFileSync(sourceHtmlPath, 'utf-8')
      : await fetchHtmlOrThrow(sourceUrl!);

    const truth = extractSourceTruth(html);
    console.log(
      `🔎 正解データ: ${truth.status} (${truth.matchedVia ?? '-'}) / ${truth.venues.length} 会場`
    );
    for (const v of truth.venues) {
      console.log(`   [${v.regionLabel ?? '-'}] ${v.venueLabel} | ${v.startsOn} 〜 ${v.endsOn}`);
    }
    if (truth.reason) console.log(`   ${truth.reason}`);
    console.log();

    for (const run of runs) {
      const extraction = readOccurrences(run);

      // ★ 照合できなかった実行を「不合格」に混ぜない。「測れなかった」を
      //   「間違っていた」として数えると、系統的失敗の件数が水増しされる。
      if (extraction.status !== 'ok') {
        console.log(`   ⏭️ ${run.label}`);
        console.log(`      ${describeExtractionFailure(extraction)}`);
        continue;
      }

      const result = compareWithSource(truth, extraction.occurrences);
      passFlags.push(result.passed);

      console.log(`   ${result.passed ? '✅' : '❌'} ${run.label}`);
      const countSuffix =
        result.actualCount === result.actualUniqueCount
          ? ''
          : ` (生 ${result.actualCount} 件 → 重複除去後 ${result.actualUniqueCount} 件)`;
      console.log(
        `      会場数: 正解 ${result.expectedCount} / 抽出 ${result.actualUniqueCount}${countSuffix}`
      );
      if (result.duplicateVenues.length > 0) {
        console.log(`      🔴 会場名の重複: ${result.duplicateVenues.join(', ')}`);
      }
      if (result.missingVenues.length > 0) {
        console.log(`      🔴 欠落: ${result.missingVenues.join(', ')}`);
      }
      if (result.fabricatedVenues.length > 0) {
        console.log(`      🔴 正解に無い会場 (捏造の疑い): ${result.fabricatedVenues.join(', ')}`);
      }
      if (result.periodMismatches.length > 0) {
        console.log(`      🟡 期間の不一致: ${result.periodMismatches.join(', ')}`);
      }
    }
    console.log();
  } else {
    console.log('ℹ️ --source / --source-html が無いため、正しさの判定は行いません。');
    console.log('   実行どうしの一致だけでは「安定して間違っている」状態を見抜けません。');
    console.log();
    // 参考情報として会場の抽出結果だけ並べる
    for (const run of runs) {
      const extraction = readOccurrences(run);
      if (extraction.status !== 'ok') {
        console.log(`   ${run.label}: ${describeExtractionFailure(extraction)}`);
        continue;
      }
      console.log(`   ${run.label}: ${venueLabelsOf(extraction).length} 会場`);
    }
    console.log();
  }

  console.log(formatRunComparison(compareRuns(runs, passFlags)));
  console.log();
}

main().catch((error) => {
  console.error('❌ 比較に失敗しました:', error);
  process.exit(1);
});
