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

import type { AiCallRecord } from '../lib/ai/observability/ai-call-recorder';
import {
  extractSourceTruth,
  compareWithSource,
  type ExtractedOccurrence,
} from '../lib/utils/source-truth-extractor';

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

/** JSONL から `detail-extraction` の occurrences を取り出す。 */
function readOccurrences(jsonlPath: string): ExtractedOccurrence[] {
  const records = readFileSync(jsonlPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AiCallRecord);

  const record = records.find((r) => r.stepId === 'detail-extraction');
  if (!record?.responseText) return [];

  try {
    const parsed = JSON.parse(record.responseText) as {
      event_data?: { occurrences?: ExtractedOccurrence[] };
    };
    return parsed.event_data?.occurrences ?? [];
  } catch {
    return [];
  }
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

  const html = htmlPath ? readFileSync(htmlPath, 'utf-8') : await fetch(url!).then((r) => r.text());
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
    const occurrences = readOccurrences(jsonlPath);
    const result = compareWithSource(truth, occurrences);
    if (!result.passed) anyFailure = true;

    console.log('-'.repeat(80));
    console.log(`${result.passed ? '✅ 一致' : '❌ 不一致'}  ${basename(jsonlPath)}`);
    console.log(
      `  会場数: 正解 ${result.expectedCount} / 抽出 ${result.actualCount}  ${result.countMatches ? '' : '⚠️'}`
    );

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
