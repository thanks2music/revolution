/**
 * まとめの表の「開催期間」と「お問い合わせ」のセルを、会場のデータからコードで組み立てる (2026-10-17 BOSS 決定)。
 *
 * 本文の LLM に雛形 (`sections/05-summary.yaml`) から書かせると、次のことが起きた (ヒロアカ):
 * - お問い合わせ: 運営元の違う会場がまざると代表店舗名が決まらず、LLM が抽出した TwitterURL (1 店舗の X) を入れた
 * - 開催期間: 会場ごとに日程が違うことを書かなかった
 *
 * 「開催場所」(`renderVenueList`、2026-10-15) と同じく、LLM が書いた行を `replaceSummaryRowValue` で置き換える。
 * 文言は Templates の `05-summary.yaml` の `rendered` (YAML が SoT)。ここは組み立てだけを行う。
 */
import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';
import { escapeMdxText } from '@/lib/utils/mdx-safety';
import { fillTemplate, tableCell } from './section-renderers';
import { formatPeriod, type PointsFormat } from './article-points';

/** `sections/05-summary.yaml` の `rendered` のうち、開催期間とお問い合わせの行の文言 */
export const SUMMARY_ROWS_KEYS = [
  'period_row_label',
  'period_open',
  'period_varies_note',
  'contact_row_label',
  'contact_single',
  'contact_multi',
] as const;

export type SummaryRowsConfig = Record<(typeof SUMMARY_ROWS_KEYS)[number], string>;

/** 会場ごとに開始日か終了日が違うか (日付の分からない会場は、分からないという値として比べる) */
export function periodsDiffer(occurrences: readonly Pick<EventDataOccurrence, 'starts_on' | 'ends_on'>[]): boolean {
  const starts = new Set(occurrences.map((o) => o.starts_on ?? null));
  const ends = new Set(occurrences.map((o) => o.ends_on ?? null));
  return starts.size > 1 || ends.size > 1;
}

/**
 * 「開催期間」のセル。期間は全会場の和集合 (`extractEventFactCardFields` の値。この記事のポイントと同じ) で、
 * 日付の書式は `01b-points.yaml` の rendered と同じ。終わりの分からないときだけ `period_open` で書く。
 * 会場ごとに日程が違えば `period_varies_note` を付ける。開始日が無ければ null (LLM の行をそのまま残す)
 */
export function renderSummaryPeriod(
  period: { start?: string; end?: string },
  occurrences: readonly Pick<EventDataOccurrence, 'starts_on' | 'ends_on'>[],
  pointsFormat: PointsFormat,
  config: SummaryRowsConfig,
): string | null {
  const text = formatPeriod(period, { ...pointsFormat, period_open: config.period_open });
  if (!text) return null;
  return periodsDiffer(occurrences) ? `${text}${config.period_varies_note}` : text;
}

/**
 * 「お問い合わせ」のセル。代表店舗名 (無ければ会場が 1 つのときはその会場) があれば `contact_single`、
 * 会場が 2 つ以上で代表が決まらなければ `contact_multi`。会場のデータが無ければ null (LLM の行をそのまま残す)。
 * 店舗名は外部のページから読んだ値なので、MDX の式として評価されないようにし、表の区切りの | も全角にする
 */
export function renderSummaryContact(
  representative: string,
  venues: readonly string[],
  config: SummaryRowsConfig,
): string | null {
  const store = representative.trim() || (venues.length === 1 ? venues[0] : '');
  if (store) return fillTemplate(config.contact_single, { 代表店舗名: tableCell(escapeMdxText(store)) });
  return venues.length >= 2 ? config.contact_multi : null;
}
