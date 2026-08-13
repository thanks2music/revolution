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
import type { PipelineStepId } from '@/lib/services/pipeline-steps';
// ★ occurrences の形 (`event_data.occurrences[]` の wire format) は照合側と共有する。
//   ここで別名の camelCase 型を作ると、`compareWithSource` に渡したときに
//   キー名が食い違って全会場が「欠落」になる (2026-08-12 に実際に作った不具合)。
import {
  parseAndNormalizeEventData,
  type EventPeriodLike,
} from '@/lib/utils/event-data-normalization';
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

/**
 * 抽出できなかった理由の表示用ラベル。
 *
 * ⚠️ `default` で `never` 検査をしている。`OccurrenceExtraction` に status を足したとき、
 * ここを書き忘れると**新しい失敗が「照合不能」とだけ表示されて理由が消える**。
 * union の追加をコンパイルエラーで気づけるようにする。
 */
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
    default: {
      const unhandled: never = extraction;
      throw new Error(
        `describeExtractionFailure: 未対応の status です: ${JSON.stringify(unhandled)}`
      );
    }
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
  /**
   * 取り出せた実行が**すべて 0 会場**だったか。
   *
   * ⚠️ これは「考えうる最悪の系統的失敗」であり、集合比較の上では「全実行一致」に
   * 見えてしまう。`--source` を付けない自己一貫性のみの表示でここが沈黙しないよう、
   * 独立したフラグとして持つ。
   */
  allEmpty: boolean;
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
/**
 * レコードの `responseText` を JSON として読む。**parse に失敗しても throw しない。**
 *
 * `extractOccurrences` と `extractNormalizedOccurrences` の共通前段。切り出したのは、
 * 両者が同じ応答を**二重に `JSON.parse` していた**ため (claude[bot] 2 巡目指摘、
 * 2026-08-14 採用)。応答は `MAX_INLINE_RESPONSE_CHARS` = 200,000 文字まで載りうるので
 * 無視できない。
 */
function readResponseJson(
  record: AiCallRecord | undefined
): Exclude<OccurrenceExtraction, { status: 'ok' }> | { status: 'ok'; parsed: unknown } {
  if (!record || !record.responseText) return { status: 'absent' };

  // truncation の判定は parse より前。切り捨てられた JSON は運良く parse できる場合も
  // あるが、その中身は「途中まで」であって比較に使ってはいけない。
  if (record.responseTruncated) return { status: 'truncated' };

  try {
    return { status: 'ok', parsed: JSON.parse(record.responseText) };
  } catch (error) {
    return {
      status: 'unparseable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function extractOccurrences(record: AiCallRecord | undefined): OccurrenceExtraction {
  const read = readResponseJson(record);
  if (read.status !== 'ok') return read;
  const parsed = read.parsed;

  // ★ `event_data` キーが丸ごと無い応答は「測れた上で 0 件」ではなく **wire format が
  //   違う** = 測れていない。strict mode では `event_data` は required (nullable) なので、
  //   キー自体の欠落はプロンプト逸脱か schema 未適用を意味する。`ok` の 0 件に潰すと、
  //   本モジュールが抽出側で潰したのと同じ誤帰属を作る。
  //   ただし `event_data: null` は正当な「イベント情報なし」なので `ok` の 0 件とする。
  const container = parsed as { event_data?: { occurrences?: unknown } | null };
  if (!(typeof container === 'object' && container !== null && 'event_data' in container)) {
    return { status: 'unparseable', reason: 'event_data キーが応答に存在しない' };
  }

  const raw = container.event_data?.occurrences;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    return { status: 'unparseable', reason: 'event_data.occurrences が配列ではない' };
  }

  const occurrences: ExtractedOccurrence[] = (((raw ?? []) as unknown[]) as Record<
    string,
    unknown
  >[]).map(
    (o) => ({
      venue_label: typeof o?.venue_label === 'string' ? o.venue_label : null,
      starts_on: typeof o?.starts_on === 'string' ? o.starts_on : null,
      ends_on: typeof o?.ends_on === 'string' ? o.ends_on : null,
    })
  );

  return { status: 'ok', occurrences };
}

/**
 * 応答から occurrences を取り出し、**パイプラインと同じ正規化**を通す。
 *
 * ## なぜ生のままではいけないのか (2026-08-14、S1-d Phase 3.8 Step A)
 *
 * パイプラインは `parseAndNormalizeEventData` を通した occurrences を frontmatter へ
 * 書き、会場の網羅性ゲートも**その正規化後の値**で判定する。一方 `extractOccurrences`
 * は LLM の生応答をそのまま返すため、両者が食い違いうる。
 *
 * 最も効くのが**連結された会場名**の扱い。LLM が `"A店、B店、C店"` を 1 要素で返した
 * とき、正規化は 3 件へ分割するのに対し生のままだと 1 件のままで、
 * **「欠落 2 件 + 正解に無い会場 1 件」に化ける**。CLI とパイプラインで判定が
 * 食い違うと、どちらが正しいのか誰にも分からなくなる。
 *
 * ⚠️ **`extractOccurrences` (生 wire) は残す。** 「LLM が言ったこと」と
 * 「パイプラインが使ったもの」は別の問いで、片方に潰すと本モジュールが守っている
 * 失敗帰属 (§ `OccurrenceExtraction`) が壊れる。CLI は両方を表示する。
 *
 * ⚠️ 正規化には `開催期間` (`fallbackPeriod` の元) が要るため、`event_data` だけでなく
 * 応答全体を読む。`prefectures` は warn にしか使われず**出力 occurrences に影響
 * しない**ので渡さない (パイプラインの結果と一致する)。
 */
export function extractNormalizedOccurrences(
  record: AiCallRecord | undefined
): OccurrenceExtraction {
  const read = readResponseJson(record);
  if (read.status !== 'ok') return read;

  // ★ `extractOccurrences` を呼び直さない (同じ応答を 2 回 parse することになる)。
  //   `event_data` キーの有無など wire format の検査は下記 `parseAndNormalizeEventData`
  //   が status で返すため、ここで重ねる必要もない。
  const parsed = read.parsed as { event_data?: unknown; 開催期間?: unknown };

  const normalized = parseAndNormalizeEventData({
    rawEventData: parsed.event_data,
    period: (parsed.開催期間 ?? null) as EventPeriodLike | null,
  });

  switch (normalized.status) {
    case 'ok':
      return { status: 'ok', occurrences: normalized.occurrences };
    case 'absent':
      // 🔴 **0 件に潰さない。** `event_data` キーが応答に無いのは「測れた上で 0 件」
      //    ではなく **wire format が違う** = 測れていない。`extractOccurrences` も
      //    同じ理由・同じ文面で `unparseable` を返しており、ここだけ緩めると
      //    「測れなかった」が「0 会場だった」として比較や照合へ混入する。
      //
      //    ⚠️ 二重 parse を解消した際 (claude[bot] 2 巡目 #2 の対応) に
      //    `extractOccurrences` の呼び出しを外したことで、「前段が弾いてくれる」と
      //    いう前提が崩れたまま本分岐が残っていた (同 4 巡目で指摘・是正)。
      return { status: 'unparseable', reason: 'event_data キーが応答に存在しない' };
    case 'invalid':
      return {
        status: 'unparseable',
        reason: `event_data が EventDataSchema に不適合: ${normalized.issues.join(' / ')}`,
      };
  }
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

/**
 * そのステップで**実際に採用された**レコードを返す。
 *
 * ## なぜ `find` ではいけないのか (2026-08-14、S1-d Phase 3.8 Step A)
 *
 * 会場の網羅性ゲートが入ったことで、`detail-extraction` は **1 実行で複数回**
 * 記録されるようになった (欠落を検出したら最大 3 回まで再抽出する)。
 *
 * `find` は**最初の**レコードを返すため、3 回目で会場が揃った実行でも
 * **1 回目 (= 却下された失敗) の応答**を読んでしまう。その結果、
 *
 * - `verify-against-source` が「合格した記事」を不合格と報告する
 * - `compareSteps` が採用されていない応答で実行間の一致・不一致を語る
 *
 * パイプラインは**成功した時点で break し、失敗した場合も最後の試行を採用する**
 * ため、どちらの場合も「最後のレコード」が採用されたものになる。
 *
 * @param records 実行のレコード列 (記録順 = `seq` 昇順)
 * @param stepId 対象ステップ
 */
export function selectAdoptedRecord(
  records: AiCallRecord[],
  stepId: PipelineStepId | 'unknown'
): AiCallRecord | undefined {
  // `findLast` は ES2023。tsconfig の lib が古い環境でも動くよう手で後ろから探す
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].stepId === stepId) return records[i];
  }
  return undefined;
}

/** ステップ単位の比較。 */
export function compareSteps(runs: RunLog[]): StepComparison[] {
  const stepIds = uniq(runs.flatMap((r) => r.records.map((rec) => rec.stepId)));

  return stepIds.map((stepId) => {
    const perRun = runs
      .map((run) => ({
        label: run.label,
        // ⚠️ 再試行があるステップでは最初のレコード = 却下された試行になりうる
        record: selectAdoptedRecord(run.records, stepId),
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
    const extraction = extractNormalizedOccurrences(
      selectAdoptedRecord(run.records, 'detail-extraction')
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

  // ⚠️ ここで null を返してはいけない。**全実行が本当に 0 会場**というのは
  //    「考えうる最悪の系統的失敗」であり、`--source` を付けない自己一貫性のみの
  //    表示でそこが沈黙すると、最も見たい signal が消える。`allEmpty` として明示する。
  const allEmpty = evaluated.length > 0 && evaluated.every((r) => r.venues.length === 0);

  const all = uniq(evaluated.flatMap((r) => r.venues));
  const alwaysPresent = all.filter((v) => evaluated.every((r) => r.venues.includes(v)));
  const sometimesPresent = all.filter((v) => !alwaysPresent.includes(v));

  return {
    evaluatedRunCount: evaluated.length,
    allEmpty,
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
    // ★ 全実行が 0 会場は「集合が一致」に見えるが、実際は最悪の系統的失敗。
    //   一致の報告に埋もれさせない。
    if (comparison.occurrences.allEmpty) {
      lines.push(
        `  🔴 取り出せた ${comparison.occurrences.evaluatedRunCount} 実行すべてで会場 0 件` +
          ` (集合としては「一致」だが、これは最悪の系統的失敗の形)`
      );
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
