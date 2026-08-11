/**
 * 公式サイトの掲載内容と抽出結果を突き合わせ、不一致を機械的に報告する。
 *
 * ## なぜ要るか
 *
 * 実行どうしの一致 (自己一貫性) は**正しさを保証しない**。3 回とも同じように会場を
 * 落とせば「完全に一致」だが「安定して間違っている」。実際、`sw2026` の直近 3 回は
 * 3 回とも東京だけを返して完全一致していた。
 *
 * 正解データは LLM を使わず HTML の構造から決定論的に作る
 * (`source-truth-extractor.ts`)。測る側が間違えると、不一致が出たときにどちらが
 * 誤りか判別できなくなるため。
 *
 * ## 使い方
 *
 * ```bash
 * cd apps/ai-writer
 *
 * # 観測ログと公式サイトを突き合わせる
 * pnpm tsx scripts/verify-against-source.ts https://kusuriya-cafe.ltr-online.com/ \
 *   --against logs/2026-08-12-kusuriya-cafe-ltr-online-com-01.jsonl
 *
 * # 正解データだけを見る (抽出結果と照合しない)
 * pnpm tsx scripts/verify-against-source.ts https://kusuriya-cafe.ltr-online.com/
 *
 * # 保存済み HTML を使う (ネットワーク不要)
 * pnpm tsx scripts/verify-against-source.ts --html debug-logs/html-xxx.html --against logs/xxx.jsonl
 * ```
 *
 * 終了コード: 不一致があれば 1、なければ 0。CI から呼べる。
 *
 * @module scripts/verify-against-source
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, basename, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });

import { extractSourceTruth, compareWithSource } from '../lib/utils/source-truth-extractor';
import {
  describeExtractionFailure,
  extractOccurrences,
  type OccurrenceExtraction,
} from '../lib/utils/run-comparison';
import { fetchHtmlOrThrow } from '../lib/utils/fetch-html';
import { readRunLog } from '../lib/utils/read-run-log';

interface Args {
  url?: string;
  htmlPath?: string;
  againstPaths: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const againstPaths: string[] = [];
  let url: string | undefined;
  let htmlPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--against') {
      againstPaths.push(argv[++i]);
    } else if (arg === '--html') {
      htmlPath = argv[++i];
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
  }

  return { url, htmlPath, againstPaths };
}

/**
 * JSONL から `detail-extraction` の occurrences を取り出す。
 *
 * ⚠️ 空配列に潰さず `status` 付きで返す。切り捨て・parse 失敗を「会場 0 件」として
 * 扱うと、観測の欠損が「全会場欠落」= 系統的失敗に化ける。
 *
 * ⚠️ JSONL の行が壊れていても throw しない (`readRunLog`)。素で `JSON.parse` すると
 * 1 行の破損で main の catch に落ち、`exit 1` が「本物の不一致を見つけた」と
 * 区別できなくなる。本スクリプトは CI から終了コードで判定される前提のため致命的。
 */
function readOccurrences(jsonlPath: string): OccurrenceExtraction {
  const { runLog, brokenLineCount } = readRunLog(jsonlPath);
  if (brokenLineCount > 0) {
    console.warn(`⚠️ ${basename(jsonlPath)}: ${brokenLineCount} 行を parse できませんでした`);
  }

  return extractOccurrences(runLog.records.find((r) => r.stepId === 'detail-extraction'));
}

async function main(): Promise<void> {
  const { url, htmlPath, againstPaths } = parseArgs();

  if (!url && !htmlPath) {
    console.error('\n❌ 公式サイトの URL も HTML パスも指定されていません\n');
    console.log('使用方法:');
    console.log('  pnpm tsx scripts/verify-against-source.ts <URL> [--against <*.jsonl>]');
    console.log('  pnpm tsx scripts/verify-against-source.ts --html <path> [--against <*.jsonl>]\n');
    process.exit(1);
  }

  const html = htmlPath ? readFileSync(htmlPath, 'utf-8') : await fetchHtmlOrThrow(url!);
  const truth = extractSourceTruth(html);

  console.log('='.repeat(80));
  console.log(`🔎 公式サイトとの事実照合: ${url ?? htmlPath}`);
  console.log('='.repeat(80));
  console.log();
  console.log(`正解データ: ${truth.status} (${truth.matchedVia ?? '-'}) / ${truth.venues.length} 会場`);

  if (truth.status === 'unsupported') {
    console.log(`  ${truth.reason}`);
    console.log();
    // ★ 照合できないことを「合格」と読ませない。
    console.log('❌ 照合不能。「測れなかった」を「正しかった」と混同しないこと。');
    process.exit(1);
  }

  for (const v of truth.venues) {
    console.log(`  [${v.regionLabel ?? '-'}] ${v.venueLabel}`);
    console.log(`      期間: ${v.startsOn} 〜 ${v.endsOn}   (原文: ${v.periodText})`);
  }
  console.log();

  if (againstPaths.length === 0) {
    console.log('ℹ️ --against が無いため正解データの表示のみで終了します。');
    return;
  }

  let anyFailure = false;

  for (const jsonlPath of againstPaths) {
    const extraction = readOccurrences(jsonlPath);

    // ★ 照合できなかったものを「一致」と読ませない。ただし「不一致」とも言わない
    //   (どちらも事実ではない)。CI 用の終了コードは 1 にする — 観測が欠けている状態を
    //   緑にすると、欠損に気づかないまま先へ進んでしまう。
    if (extraction.status !== 'ok') {
      anyFailure = true;
      console.log('-'.repeat(80));
      console.log(`⏭️ 照合不能  ${basename(jsonlPath)}`);
      console.log(`  ${describeExtractionFailure(extraction)}`);
      console.log();
      continue;
    }

    const result = compareWithSource(truth, extraction.occurrences);
    if (!result.passed) anyFailure = true;

    console.log('-'.repeat(80));
    console.log(`${result.passed ? '✅ 一致' : '❌ 不一致'}  ${basename(jsonlPath)}`);
    const countSuffix =
      result.actualCount === result.actualUniqueCount
        ? ''
        : ` (生 ${result.actualCount} 件 → 重複除去後 ${result.actualUniqueCount} 件)`;
    console.log(
      `  会場数: 正解 ${result.expectedCount} / 抽出 ${result.actualUniqueCount}${countSuffix}  ${result.countMatches ? '' : '⚠️'}`
    );
    if (result.duplicateVenues.length > 0) {
      console.log(`  🔴 会場名の重複: ${result.duplicateVenues.join(', ')}`);
    }

    for (const v of result.venues) {
      if (v.presence === 'missing-from-extraction') {
        console.log(`  🔴 欠落      : ${v.venueLabel} (正解 ${v.expected?.startsOn} 〜 ${v.expected?.endsOn})`);
      } else if (v.presence === 'not-in-source') {
        console.log(`  🔴 正解に無い: ${v.venueLabel} (捏造の疑い)`);
      } else if (!v.periodMatches) {
        console.log(`  🟡 期間相違  : ${v.venueLabel}`);
        console.log(`      正解 ${v.expected?.startsOn} 〜 ${v.expected?.endsOn}`);
        console.log(`      抽出 ${v.actual?.startsOn} 〜 ${v.actual?.endsOn}`);
      } else {
        console.log(`  ✅ ${v.venueLabel} (${v.actual?.startsOn} 〜 ${v.actual?.endsOn})`);
      }
    }
    console.log();
  }

  // 不一致があれば非ゼロで終わる。偽陰性 (間違いの見逃し) が最も重いので、
  // 判定を握り潰さない。
  process.exit(anyFailure ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ 照合に失敗しました:', error);
  process.exit(1);
});
