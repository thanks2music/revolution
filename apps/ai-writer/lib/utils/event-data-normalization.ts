/**
 * `event_data` の parse + `occurrences[]` 正規化を **1 箇所に集約**する。
 *
 * ## なぜ切り出したか (2026-08-14、S1-d Phase 3.8 Step A)
 *
 * 会場の網羅性ゲート (`venue-completeness-gate.ts`) は「**frontmatter に載る
 * occurrences**」を正解データと照合する。一方で照合ツール
 * (`verify-against-source.ts` / `compare-runs.ts`) は JSONL の生応答から
 * occurrences を組み立てる。この 2 つが**別々の実装**だと、
 *
 * - ゲートは通ったのに記事は別の occurrences で書かれる
 * - CLI で「合格」と出たのにパイプラインでは停止する (逆も)
 *
 * という食い違いが起きる。実際 2026-08-12 には `ExtractedOccurrence` のキーを
 * 全て optional にしていたせいで camelCase の別型が型チェックを通過し、
 * **全会場が「欠落」と誤判定された**事故がある。
 *
 * よって parse も正規化も**この関数だけ**が行い、パイプライン・ゲート・CLI の
 * 3 者が同じ関数を通ることを型で担保する。
 *
 * ## 「測れなかった」と「0 件だった」を混同しない
 *
 * 戻り値は判別可能ユニオン。schema 不適合を空配列へ潰すと、
 * **プロンプト逸脱が「会場 0 件」= 抽出の失敗として誤って帰属される**。
 * これは `run-comparison.ts` が守っているのと同じ主張。
 */

import {
  EventDataSchema,
  type EventData,
  type EventDataOccurrence,
} from '@revolution/schemas/mdx-frontmatter';
import { toIsoDate } from '@/lib/utils/event-fact-card-mapper';
import { normalizeOccurrences } from '@/lib/utils/occurrence-normalizer';

/**
 * `開催期間` の構造的部分型。
 *
 * `ExtractionResult.開催期間` (`EventPeriod`) をそのまま渡せるが、CLI が JSONL の
 * 生 JSON から組み立てたオブジェクトも受けられるよう、各キーを optional にしている。
 */
export interface EventPeriodLike {
  開始?: { 年?: string | null; 日付?: string | null } | null;
  終了?: { 年?: string | null; 日付?: string | null; 未定?: boolean | null } | null;
}

export interface ParseAndNormalizeEventDataInput {
  /** LLM 応答の `event_data` (未検証。`ExtractionResult.event_data` は `unknown` 型) */
  rawEventData: unknown;
  /** `starts_on` / `ends_on` が欠落した occurrence を補完するための既定期間 */
  period?: EventPeriodLike | null;
  /**
   * 会場数の cross-check に使う (`normalizeOccurrences` 内で warn を出すだけで、
   * **出力 occurrences には影響しない**)。
   *
   * パイプラインは metadata-generation 後の解決済み `prefectures` を渡せるが、
   * ゲートは detail-extraction 時点で走るため渡せない。影響しないことを実コードで
   * 確認済みなので、**両者の occurrences は一致する** (warn の有無だけが違う)。
   */
  prefectures?: string[] | null;
}

export type ParseAndNormalizeEventDataResult =
  /** `event_data` を読めて正規化まで通った (0 件も含む正当な結果) */
  | { status: 'ok'; eventData: EventData; occurrences: EventDataOccurrence[]; warnings: string[] }
  /** `event_data` キー自体が応答に無い。「0 件だった」ではない */
  | { status: 'absent' }
  /** `event_data` はあるが `EventDataSchema` に不適合。**測れていない** */
  | { status: 'invalid'; issues: string[] };

/**
 * `event_data` を parse し `occurrences[]` を正規化する。純粋関数 (ログを出さない)。
 *
 * `warnings` は呼び出し側がログへ出す。**ゲートは出さない** — 採用しなかった試行の
 * 警告まで出すと、記事に反映された内容とログが食い違うため。
 */
export function parseAndNormalizeEventData(
  input: ParseAndNormalizeEventDataInput
): ParseAndNormalizeEventDataResult {
  if (input.rawEventData === undefined) return { status: 'absent' };

  const parsed = EventDataSchema.safeParse(input.rawEventData);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  // ★ 多開催の正規化。プロンプトで「会場ごとに 1 要素」と指示していても
  //   LLM が連結に回帰しうるため、アプリ側でも防御的に分割する
  //   (`store-name-validator.ts` と同じ設計思想)。年跨ぎの終了年省略も補正。
  const normalized = normalizeOccurrences({
    occurrences: parsed.data.occurrences,
    prefectures: input.prefectures,
    fallbackPeriod: buildFallbackPeriod(input.period),
  });

  return {
    status: 'ok',
    eventData: { ...parsed.data, occurrences: normalized.occurrences },
    occurrences: normalized.occurrences,
    warnings: normalized.warnings,
  };
}

/**
 * `開催期間` から `normalizeOccurrences` の `fallbackPeriod` を組み立てる。
 *
 * ⚠️ `終了.未定 === true` は「終了日が無いことが事実」なので `null` を返す。
 * ここで開始日等で埋めると**測れなかったものを測れたことにする**。
 */
function buildFallbackPeriod(
  period: EventPeriodLike | null | undefined
): { startsOn: string | null; endsOn: string | null } {
  return {
    startsOn: toIsoDate(normalizeDatePart(period?.開始)) ?? null,
    endsOn:
      period?.終了?.未定 === true ? null : (toIsoDate(normalizeDatePart(period?.終了)) ?? null),
  };
}

/** optional なキーを `toIsoDate` が要求する `{ 年, 日付 }` 形へ寄せる。 */
function normalizeDatePart(
  part: { 年?: string | null; 日付?: string | null } | null | undefined
): { 年: string | null; 日付: string | null } | null {
  if (part == null) return null;
  return { 年: part.年 ?? null, 日付: part.日付 ?? null };
}
