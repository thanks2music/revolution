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
// ★ occurrences の形 (`event_data.occurrences[]` の wire format) は照合側と共有する。
//   ここで別名の camelCase 型を作ると、`compareWithSource` に渡したときに
//   キー名が食い違って全会場が「欠落」になる (2026-08-12 に実際に作った不具合)。
import type { ExtractedOccurrence } from '@/lib/utils/source-truth-extractor';

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

/**
 * 応答から occurrences を取り出した結果。
 *
 * ## なぜ「空配列」で済ませないか
 *
 * 「会場 0 件」には**性質の違う 4 つ**が混ざる。空配列に潰すと、
 * **「測れなかった」が「0 件だった」= 系統的失敗として誤って帰属される**。
 *
 * | status | 意味 | 失敗帰属 |
 * |---|---|---|
 * | `ok` | parse できて occurrences を取れた (0 件もあり得る) | 内容で判定してよい |
 * | `truncated` | 応答が上限で切り捨てられていた (`responseTruncated`) | **判定不能**。観測の欠損 |
 * | `unparseable` | 応答が JSON として読めなかった | **判定不能**。LLM 側の失敗か observability の欠損か切り分けが要る |
 * | `absent` | そのステップのレコード自体が無い / 応答が空 | **判定不能**。実行がそこまで到達していない |
 */
export type OccurrenceExtraction =
  | { status: 'ok'; occurrences: ExtractedOccurrence[] }
  | { status: 'truncated' }
  | { status: 'unparseable'; reason: string }
  | { status: 'absent' };

/** 抽出できなかった理由の表示用ラベル。 */
export function describeExtractionFailure(
  extraction: Exclude<OccurrenceExtraction, { status: 'ok' }>
): string {
  switch (extraction.status) {
    case 'truncated':
      return '照合不能: 応答が上限で切り捨てられている (responseTruncated)';
    case 'unparseable':
      return `照合不能: 応答が JSON として読めない (${extraction.reason})`;
    case 'absent':
      return '照合不能: 該当ステップのレコードが無い';
  }
}

/** 実行間で occurrences がどう割れたか。 */
export interface OccurrenceComparison {
  /**
   * occurrences を実際に取り出せた実行の数。
   *
   * **0 なら一致・不一致のどちらでもない (判定不能)。** `venueSetIdentical` の
   * false を「不一致」と読まないための判別子。
   */
  evaluatedRunCount: number;
  /** 全実行で会場名の集合が一致したか (`evaluatedRunCount === 0` のときは常に false) */
  venueSetIdentical: boolean;
  /**
   * 実行ラベル → 会場名の配列。
   *
   * `extraction` が `ok` でない実行は `venues` が空になるため、**`venues.length === 0`
   * だけを見て「会場を落とした」と結論してはいけない**。必ず `extraction.status` を見る。
   */
  perRun: { label: string; venues: string[]; extraction: OccurrenceExtraction }[];
  /** 全実行に共通して出た会場 (`ok` の実行のみで判定) */
  alwaysPresent: string[];
  /** 一部の実行にしか出なかった会場 (= 揺れているもの) */
  sometimesPresent: string[];
  /** occurrences を取り出せなかった実行 (判定から除外したもの) */
  unevaluatedRuns: { label: string; reason: string }[];
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
 * `detail-extraction` の応答から `occurrences[]` を取り出す。
 *
 * 応答は Structured Outputs の JSON だが、**parse に失敗しても throw しない**。
 * 比較ツールがログの不備で落ちると、調べたい対象そのものを見られなくなる。
 *
 * ⚠️ 失敗を空配列に潰さず `status` で返す。`responseTruncated` を見ずに parse すると、
 * **切り捨てられた応答が「会場 0 件」= 系統的失敗として誤って帰属される**。
 * 「測れなかった」と「0 件だった」を混同しないことが本モジュールの主張そのもの。
 */
export function extractOccurrences(record: AiCallRecord | undefined): OccurrenceExtraction {
  if (!record || !record.responseText) return { status: 'absent' };

  // truncation の判定は parse より前。切り捨てられた JSON は運良く parse できる場合も
  // あるが、その中身は「途中まで」であって比較に使ってはいけない。
  if (record.responseTruncated) return { status: 'truncated' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(record.responseText);
  } catch (error) {
    return {
      status: 'unparseable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const raw = (parsed as { event_data?: { occurrences?: unknown } })?.event_data?.occurrences;
  if (raw !== undefined && !Array.isArray(raw)) {
    return { status: 'unparseable', reason: 'event_data.occurrences が配列ではない' };
  }

  const occurrences: ExtractedOccurrence[] = ((raw ?? []) as Record<string, unknown>[]).map(
    (o) => ({
      venue_label: typeof o?.venue_label === 'string' ? o.venue_label : null,
      starts_on: typeof o?.starts_on === 'string' ? o.starts_on : null,
      ends_on: typeof o?.ends_on === 'string' ? o.ends_on : null,
    })
  );

  return { status: 'ok', occurrences };
}

/**
 * `extractOccurrences` の結果から会場名だけを取り出す。
 *
 * ⚠️ 非 `ok` は空配列になる。呼び出し側は必ず `status` を先に見ること。
 */
export function venueLabelsOf(extraction: OccurrenceExtraction): string[] {
  if (extraction.status !== 'ok') return [];
  return extraction.occurrences
    .map((o) => o.venue_label)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
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

/**
 * occurrences の会場集合を実行間で比較する。
 *
 * ⚠️ 会場集合の一致・不一致は **`ok` だった実行だけで判定する**。取り出せなかった実行を
 * 「会場 0 件」として混ぜると、観測の欠損が「安定して落としている」ように見える。
 * 除外した実行は `unevaluatedRuns` に理由付きで残す (黙って捨てない)。
 */
export function compareOccurrences(runs: RunLog[]): OccurrenceComparison | null {
  // どの実行も `detail-extraction` まで到達していないなら occurrences について
  // 述べることが無い (そのこと自体は `compareSteps` 側に出る)。
  const anyReachedStep = runs.some((run) =>
    run.records.some((r) => r.stepId === 'detail-extraction')
  );
  if (!anyReachedStep) return null;

  const perRun = runs.map((run) => {
    const extraction = extractOccurrences(
      run.records.find((r) => r.stepId === 'detail-extraction')
    );
    return { label: run.label, venues: venueLabelsOf(extraction), extraction };
  });

  const evaluated = perRun.filter((r) => r.extraction.status === 'ok');
  const unevaluatedRuns = perRun
    .filter((r) => r.extraction.status !== 'ok')
    .map((r) => ({
      label: r.label,
      reason: describeExtractionFailure(
        r.extraction as Exclude<OccurrenceExtraction, { status: 'ok' }>
      ),
    }));

  if (evaluated.every((r) => r.venues.length === 0) && unevaluatedRuns.length === 0) return null;

  const all = uniq(evaluated.flatMap((r) => r.venues));
  const alwaysPresent = all.filter((v) => evaluated.every((r) => r.venues.includes(v)));
  const sometimesPresent = all.filter((v) => !alwaysPresent.includes(v));

  return {
    evaluatedRunCount: evaluated.length,
    // 取り出せなかった実行が 1 つでもあれば「一致した」と主張しない。
    // 判定に使える実行が 0 なら一致・不一致のどちらでもない (表示側で「判定不能」を出す)。
    venueSetIdentical:
      evaluated.length > 0 && sometimesPresent.length === 0 && unevaluatedRuns.length === 0,
    perRun,
    alwaysPresent,
    sometimesPresent,
    unevaluatedRuns,
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
export function formatRunComparison(
  comparison: RunComparison,
  /**
   * 合否判定から外した実行のラベル。
   *
   * ⚠️ **渡すこと。** 判定は評価できた実行だけを分母にするため、除外があったことを
   * 要約に出さないと「3 実行のうち 1 つを除いた 2/2」を見て系統的と読む恐れがある。
   */
  skippedRunLabels: string[] = []
): string {
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
    lines.push(
      `occurrences の会場集合: ${
        comparison.occurrences.evaluatedRunCount === 0
          ? '⚠️ 判定不能 (どの実行からも occurrences を取り出せていない)'
          : mark(comparison.occurrences.venueSetIdentical)
      }`
    );
    for (const run of comparison.occurrences.perRun) {
      if (run.extraction.status !== 'ok') {
        // 「0 件」と書かない。測れなかったことが会場欠落に見えるのを防ぐ。
        lines.push(
          `  ${run.label}: ${describeExtractionFailure(
            run.extraction as Exclude<OccurrenceExtraction, { status: 'ok' }>
          )}`
        );
        continue;
      }
      lines.push(`  ${run.label}: ${run.venues.length} 件`);
      for (const v of run.venues) lines.push(`    - ${v}`);
    }
    if (comparison.occurrences.unevaluatedRuns.length > 0) {
      lines.push(
        `  ⚠️ 会場集合の判定から除外した実行 ${comparison.occurrences.unevaluatedRuns.length} 件 (上記の理由で照合不能)`
      );
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
    lines.push(
      `歩留まり: ${comparison.passRate.passed} / ${comparison.passRate.total} (参考値。合否には使わない)`
    );
  }
  // ★ 分母が全実行数と一致しないことを要約の側で言う。per-run の ⏭️ 行まで
  //   スクロールしないと気づけない状態にしない。
  if (skippedRunLabels.length > 0) {
    lines.push(
      `⚠️ 判定から除外: ${skippedRunLabels.length} / ${comparison.runLabels.length} 実行` +
        ` (${skippedRunLabels.join(', ')})`
    );
    lines.push('   上の判定はこれらを除いた残りだけで出しています。');
  }

  return lines.join('\n');
}

/** 1 実行ぶんの照合結果の要約 (終了コード判定用)。 */
export interface VerificationOutcome {
  /** 照合できて合格した */
  passed?: boolean;
  /** 照合そのものができなかった (切り捨て / parse 失敗 / レコード無し / 正解データ不成立) */
  unevaluated?: boolean;
}

/**
 * CI 用の終了コードを決める。
 *
 * ## なぜ純粋関数に切り出すか
 *
 * `verify-against-source.ts` は「不一致があれば 1」と謳っており、**CI から終了コードで
 * 判定される前提**である。ところが判定は 3 箇所で `anyFailure = true` を立てる散在した
 * 手続きで、テストが無かった。契約が壊れても誰も気づけない。
 *
 * ## なぜ「照合不能」も 1 にするか
 *
 * 緑にすると**観測が欠けている状態に気づかないまま先へ進む**。「測れなかった」を
 * 「問題なし」と読ませないのが本モジュール群の主張であり、終了コードでも同じ扱いにする。
 * 「不一致」と「照合不能」の区別は標準出力の文言側で行う。
 *
 * @returns 0 = 全件が照合できて合格 / 1 = 不一致または照合不能が 1 件以上
 */
export function decideVerificationExitCode(outcomes: VerificationOutcome[]): 0 | 1 {
  if (outcomes.length === 0) return 0;
  const hasProblem = outcomes.some((o) => o.unevaluated === true || o.passed === false);
  return hasProblem ? 1 : 0;
}
