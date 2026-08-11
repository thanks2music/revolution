/**
 * Run Comparison — 同一 URL を N 回実行した観測ログ (JSONL) を突き合わせ、
 * 「どこが同じで、どこが違うか」だけを取り出す。
 *
 * ## 何のために要るか
 *
 * 前セッションは「同一入力なのに出力が変わる」ことを確かめるために、保存 HTML の
 * `shasum` を手打ちし、ログを目視で並べ、5 時間を費やした。本モジュールはその作業を
 * 機械の側に移す。
 *
 * ## 「系統的」と「確率的」を分ける
 *
 * Phase 3.6 の合否はこの区別で決まる。
 *
 * | 失敗の性質 | 再実行で救えるか | 対処 |
 * |---|---|---|
 * | 確率的 (3 回中 1 回は通る) | ✅ 救える | 再実行で運用できる。3.6 の対象外 |
 * | **系統的 (3 回とも通らない)** | ❌ 救えない | プロンプト・セレクタの是正が要る。**これが 3.6 の本体** |
 *
 * ⚠️ **自己一貫性だけでは判定できない。** 3 回とも同じように会場を落とせば
 * 「完全に一致している」が「安定して間違っている」。合否には
 * `source-truth-extractor.ts` による正解との突き合わせ結果を渡すこと。
 *
 * @module lib/utils/run-comparison
 */

import type { AiCallRecord } from '@/lib/ai/observability/ai-call-recorder';

/** 1 実行ぶんの観測ログ。 */
export interface RunLog {
  /** 表示用のラベル (通常は JSONL のファイル名) */
  label: string;
  records: AiCallRecord[];
}

/** あるステップについて、実行間で何が一致し何が割れたか。 */
export interface StepComparison {
  stepId: string;
  /** そのステップを含んでいた実行の数 */
  runCount: number;
  /** 入力プロンプトが全実行で同一か */
  promptIdentical: boolean;
  /** 観測された prompt ハッシュ (短縮) */
  promptShas: string[];
  /** 出力が全実行で同一か */
  responseIdentical: boolean;
  responseShas: string[];
  /** 要求モデル (通常 1 種) */
  requestedModels: string[];
  /** 応答モデル。ここが割れていればモデル基盤が変わっている */
  resolvedModels: string[];
  /**
   * `system_fingerprint`。OpenAI が供給しない場合は `null` が並ぶ
   * (実測 2026-08-11: `gpt-5.4-mini` は全件 null)。
   */
  systemFingerprints: (string | null)[];
  /** 最小・最大の所要時間 (ms) */
  latencyMsRange: [number, number];
  /** 失敗した実行のラベル */
  erroredRuns: string[];
}

/** 実行間で occurrences がどう割れたか。 */
export interface OccurrenceComparison {
  /** 全実行で会場名の集合が一致したか */
  venueSetIdentical: boolean;
  /** 実行ラベル → 会場名の配列 */
  perRun: { label: string; venues: string[] }[];
  /** 全実行に共通して出た会場 */
  alwaysPresent: string[];
  /** 一部の実行にしか出なかった会場 (= 揺れているもの) */
  sometimesPresent: string[];
}

/**
 * 失敗の性質。**合否フラグを渡さない限り判定しない** — 自己一貫性から
 * 正しさを推定してはいけないため。
 */
export type FailureNature =
  | 'all-passed'
  | 'systematic'
  | 'probabilistic'
  | 'not-evaluated';

export interface RunComparison {
  runLabels: string[];
  steps: StepComparison[];
  occurrences: OccurrenceComparison | null;
  nature: FailureNature;
  /** 合否が渡された場合の内訳 */
  passRate?: { passed: number; total: number };
}

/** ハッシュを読みやすい長さに切る。比較の意味は変わらない。 */
function short(hash: string | undefined): string {
  return hash ? hash.slice(0, 12) : '(なし)';
}

/** 重複を除いた順序保存の配列。 */
function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * `detail-extraction` の応答から `occurrences[]` の会場名を取り出す。
 *
 * 応答は Structured Outputs の JSON だが、**parse に失敗しても throw しない**。
 * 比較ツールがログの不備で落ちると、調べたい対象そのものを見られなくなる。
 */
export function extractVenueLabels(record: AiCallRecord | undefined): string[] {
  if (!record?.responseText) return [];
  try {
    const parsed = JSON.parse(record.responseText) as {
      event_data?: { occurrences?: { venue_label?: string | null }[] };
    };
    const occurrences = parsed.event_data?.occurrences ?? [];
    return occurrences
      .map((o) => o.venue_label)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
}

/** ステップ単位の比較。 */
export function compareSteps(runs: RunLog[]): StepComparison[] {
  const stepIds = uniq(runs.flatMap((r) => r.records.map((rec) => rec.stepId)));

  return stepIds.map((stepId) => {
    const perRun = runs
      .map((run) => ({
        label: run.label,
        record: run.records.find((rec) => rec.stepId === stepId),
      }))
      .filter((x): x is { label: string; record: AiCallRecord } => x.record !== undefined);

    const promptShas = uniq(perRun.map((x) => short(x.record.promptSha256)));
    const responseShas = uniq(perRun.map((x) => short(x.record.responseSha256)));
    const latencies = perRun.map((x) => x.record.latencyMs);

    return {
      stepId,
      runCount: perRun.length,
      promptIdentical: promptShas.length === 1,
      promptShas,
      responseIdentical: responseShas.length === 1,
      responseShas,
      requestedModels: uniq(perRun.map((x) => x.record.requestedModel)),
      resolvedModels: uniq(perRun.map((x) => x.record.resolvedModel ?? '(未記録)')),
      systemFingerprints: uniq(perRun.map((x) => x.record.systemFingerprint ?? null)),
      latencyMsRange: [Math.min(...latencies), Math.max(...latencies)],
      erroredRuns: perRun.filter((x) => x.record.error).map((x) => x.label),
    };
  });
}

/** occurrences の会場集合を実行間で比較する。 */
export function compareOccurrences(runs: RunLog[]): OccurrenceComparison | null {
  const perRun = runs.map((run) => ({
    label: run.label,
    venues: extractVenueLabels(run.records.find((r) => r.stepId === 'detail-extraction')),
  }));

  if (perRun.every((r) => r.venues.length === 0)) return null;

  const all = uniq(perRun.flatMap((r) => r.venues));
  const alwaysPresent = all.filter((v) => perRun.every((r) => r.venues.includes(v)));
  const sometimesPresent = all.filter((v) => !alwaysPresent.includes(v));

  return {
    venueSetIdentical: sometimesPresent.length === 0,
    perRun,
    alwaysPresent,
    sometimesPresent,
  };
}

/**
 * 失敗が系統的か確率的かを判定する。
 *
 * @param passFlags 実行ごとの合否。**正解との突き合わせ結果を渡すこと。**
 *   自己一貫性 (実行どうしの一致) を渡すと「安定して間違っている」状態を
 *   合格と誤判定する。
 */
export function classifyFailureNature(passFlags: boolean[]): FailureNature {
  if (passFlags.length === 0) return 'not-evaluated';
  if (passFlags.every(Boolean)) return 'all-passed';
  if (passFlags.every((p) => !p)) return 'systematic';
  return 'probabilistic';
}

/** N 実行ぶんの観測ログを比較する。 */
export function compareRuns(runs: RunLog[], passFlags: boolean[] = []): RunComparison {
  return {
    runLabels: runs.map((r) => r.label),
    steps: compareSteps(runs),
    occurrences: compareOccurrences(runs),
    nature: classifyFailureNature(passFlags),
    passRate:
      passFlags.length > 0
        ? { passed: passFlags.filter(Boolean).length, total: passFlags.length }
        : undefined,
  };
}

/** 比較結果を人が読む形に整形する。 */
export function formatRunComparison(comparison: RunComparison): string {
  const lines: string[] = [];
  const mark = (ok: boolean) => (ok ? '一致' : '⚠️ 不一致');

  lines.push(`比較対象 ${comparison.runLabels.length} 実行:`);
  for (const label of comparison.runLabels) lines.push(`  - ${label}`);
  lines.push('');

  lines.push('ステップ別:');
  for (const step of comparison.steps) {
    lines.push(`  [${step.stepId}] ${step.runCount} 実行`);
    lines.push(
      `    入力プロンプト: ${mark(step.promptIdentical)}  ${step.promptShas.join(' / ')}`
    );
    lines.push(`    出力          : ${mark(step.responseIdentical)}  ${step.responseShas.join(' / ')}`);
    lines.push(
      `    モデル        : 要求 ${step.requestedModels.join(' / ')} → 応答 ${step.resolvedModels.join(' / ')}`
    );
    lines.push(
      `    fingerprint   : ${step.systemFingerprints.map((f) => f ?? 'null (未供給)').join(' / ')}`
    );
    lines.push(`    所要時間      : ${step.latencyMsRange[0]}〜${step.latencyMsRange[1]}ms`);
    if (step.erroredRuns.length > 0) {
      lines.push(`    ⚠️ 失敗した実行: ${step.erroredRuns.join(', ')}`);
    }
  }

  if (comparison.occurrences) {
    lines.push('');
    lines.push(`occurrences の会場集合: ${mark(comparison.occurrences.venueSetIdentical)}`);
    for (const run of comparison.occurrences.perRun) {
      lines.push(`  ${run.label}: ${run.venues.length} 件`);
      for (const v of run.venues) lines.push(`    - ${v}`);
    }
    if (comparison.occurrences.sometimesPresent.length > 0) {
      lines.push('  ⚠️ 実行によって出たり出なかったりする会場:');
      for (const v of comparison.occurrences.sometimesPresent) lines.push(`    - ${v}`);
    }
  }

  lines.push('');
  const natureLabel: Record<FailureNature, string> = {
    'all-passed': '全実行が正解と一致',
    systematic: '🔴 系統的 (どの実行も通らない → プロンプト・セレクタの是正が要る)',
    probabilistic: '🟡 確率的 (再実行で救える → Phase 3.6 の対象外)',
    'not-evaluated':
      '判定なし (正解との突き合わせ結果が渡されていない。自己一貫性だけでは「安定して間違っている」状態を見抜けない)',
  };
  lines.push(`判定: ${natureLabel[comparison.nature]}`);
  if (comparison.passRate) {
    lines.push(`歩留まり: ${comparison.passRate.passed} / ${comparison.passRate.total} (参考値。合否には使わない)`);
  }

  return lines.join('\n');
}
