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

import {
  compareWithSource,
  extractSourceTruth,
  formatSourceComparisonLines,
  warnOnceForSourceIssues,
} from '../lib/utils/source-truth-extractor';
import {
  decideVerificationExitCode,
  describeExtractionFailure,
  extractNormalizedOccurrences,
  extractOccurrences,
  selectAdoptedRecord,
  type OccurrenceExtraction,
  type VerificationOutcome,
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
function readOccurrences(jsonlPath: string): {
  /** 判定に使う値。パイプラインが frontmatter へ書くのと同じ正規化を通したもの */
  normalized: OccurrenceExtraction;
  /** LLM が返したままの値。正規化との差を表示するためだけに使う */
  raw: OccurrenceExtraction;
} {
  const { runLog, brokenLineCount } = readRunLog(jsonlPath);
  if (brokenLineCount > 0) {
    console.warn(`⚠️ ${basename(jsonlPath)}: ${brokenLineCount} 行を parse できませんでした`);
  }

  // ⚠️ `find` ではなく `selectAdoptedRecord`。会場の網羅性ゲートが入ったことで
  //    `detail-extraction` は 1 実行で最大 3 レコードになり、`find` は
  //    **却下された 1 回目**を掴む (S1-d Phase 3.8 Step A)。
  const record = selectAdoptedRecord(runLog.records, 'detail-extraction');

  return {
    normalized: extractNormalizedOccurrences(record),
    raw: extractOccurrences(record),
  };
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
  console.log(
    `正解データ: ${truth.status} (profile=${truth.profileId ?? '-'} / ${truth.matchedVia ?? '-'}) / ${truth.venues.length} 会場`
  );

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

  // ★ 終了コードの判定は純粋関数へ委ねる (CI が依存する契約なのでテスト可能にする)
  const outcomes: VerificationOutcome[] = [];
  /** 正解データ側の警告を出したか (実行ごとに重複させない)。 */
  let sourceIssueWarned = false;

  for (const jsonlPath of againstPaths) {
    const { normalized: extraction, raw: rawExtraction } = readOccurrences(jsonlPath);

    // ★ 照合できなかったものを「一致」と読ませない。ただし「不一致」とも言わない
    //   (どちらも事実ではない)。CI 用の終了コードは 1 にする — 観測が欠けている状態を
    //   緑にすると、欠損に気づかないまま先へ進んでしまう。
    if (extraction.status !== 'ok') {
      outcomes.push({ unevaluated: true });
      console.log('-'.repeat(80));
      console.log(`⏭️ 照合不能  ${basename(jsonlPath)}`);
      console.log(`  ${describeExtractionFailure(extraction)}`);
      console.log();
      continue;
    }

    const result = compareWithSource(truth, extraction.occurrences);
    outcomes.push({ passed: result.passed });

    // ★ パイプラインは正規化後の occurrences を frontmatter へ書き、ゲートも
    //   その値で判定する。生との差 (「A店、B店」の分割等) が出た実行は、
    //   生のまま数えると欠落・捏造に化けるので明示する。
    if (rawExtraction.status === 'ok' && rawExtraction.occurrences.length !== extraction.occurrences.length) {
      console.log(
        `  ℹ️ 正規化: 生 ${rawExtraction.occurrences.length} 件 → ${extraction.occurrences.length} 件` +
          ' (連結された会場名の分割・重複除去)'
      );
    }
    // 正解データは全実行で共通なので警告は 1 回だけ
    if (!sourceIssueWarned) sourceIssueWarned = warnOnceForSourceIssues(result);

    console.log('-'.repeat(80));
    console.log(`${result.passed ? '✅ 一致' : '❌ 不一致'}  ${basename(jsonlPath)}`);
    // 表示は compare-runs.ts と共有する (同じデータで違う結論に見えないように)
    for (const line of formatSourceComparisonLines(result, '  ')) console.log(line);

    for (const v of result.venues) {
      if (v.presence === 'both' && v.periodMatches) {
        console.log(`  ✅ ${v.venueLabel} (${v.actual?.startsOn} 〜 ${v.actual?.endsOn})`);
      }
    }

    console.log();
  }

  // 不一致があれば非ゼロで終わる。偽陰性 (間違いの見逃し) が最も重いので、
  // 判定を握り潰さない。照合不能も 1 とする (緑にすると欠損に気づかない)。
  process.exit(decideVerificationExitCode(outcomes));
}

main().catch((error) => {
  console.error('❌ 照合に失敗しました:', error);
  process.exit(1);
});
