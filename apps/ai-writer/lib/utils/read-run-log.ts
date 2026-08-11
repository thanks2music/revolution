/**
 * 観測ログ (JSONL) の読み込み。
 *
 * ## なぜ共通化するか
 *
 * `compare-runs.ts` と `verify-against-source.ts` が同じ JSONL を読むのに、
 * **一方は壊れた行を try/catch で拾い、もう一方は素で `JSON.parse` していた**。
 * 後者は 1 行でも壊れていると throw し、`main().catch()` に落ちて
 * `❌ 照合に失敗しました` + exit 1 になる。つまり
 * **「ログ行が読めなかった」と「本物の不一致を見つけた」が区別できない**。
 *
 * これは本モジュール群の主張 (「測れなかった」を「間違っていた」と混同しない) の
 * 自己違反であり、CI から終了コードで判定する用途では特に困る。
 *
 * @module lib/utils/read-run-log
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

import type { AiCallRecord } from '@/lib/ai/observability/ai-call-recorder';
import type { RunLog } from '@/lib/utils/run-comparison';

/** JSONL の読み込み結果。壊れた行の件数も返す (黙って捨てない)。 */
export interface RunLogReadResult {
  runLog: RunLog;
  /** parse できなかった行の数 */
  brokenLineCount: number;
}

/**
 * JSONL を 1 行ずつ読む。**壊れた行があっても throw しない**。
 *
 * 実行がログの書き込み途中でクラッシュすると末尾の行が不完全になる。そこで全体を
 * 諦めると、直前までの正常なレコードまで読めなくなる。
 *
 * @param path JSONL のパス
 */
export function readRunLog(path: string): RunLogReadResult {
  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const records: AiCallRecord[] = [];
  let brokenLineCount = 0;

  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as AiCallRecord);
    } catch {
      brokenLineCount++;
    }
  }

  return {
    runLog: { label: basename(path, '.jsonl'), records },
    brokenLineCount,
  };
}
