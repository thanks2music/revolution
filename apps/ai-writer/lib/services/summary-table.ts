/**
 * まとめの表の「開催期間」と「お問い合わせ」のセルを、会場のデータからコードで組み立てる (2026-10-17 BOSS 決定)。
 *
 * 本文の LLM に雛形 (`sections/05-summary.yaml`) から書かせると、次のことが起きた (ヒロアカ):
 * - お問い合わせ: 運営元の違う会場がまざると代表店舗名が決まらず、LLM が抽出した TwitterURL (1 店舗の X) を入れた
 * - 開催期間: 会場ごとに日程が違うことを書かなかった
 *
 * 「開催場所」(`renderVenueList`、2026-10-15) と同じく、LLM が書いた行を置き換える。LLM が行を書かなかったときは、
 * 雛形の行の順で 1 つ前の行の後ろに足す (`applySummaryRows` → `upsertSummaryRow`)。
 * 文言は Templates の `05-summary.yaml` の `rendered` (YAML が SoT)。ここは組み立てだけを行う。
 */
import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';
import { escapeMdxText } from '@/lib/utils/mdx-safety';
import { fillTemplate, tableCell, upsertSummaryRow } from './section-renderers';
import { formatPeriod, type PointsFormat } from './article-points';

/** `sections/05-summary.yaml` の `rendered` のうち、開催期間とお問い合わせの行の文言 */
export const SUMMARY_ROWS_KEYS = [
  'period_row_label',
  'period_open',
  'period_varies_note',
  'map_row_label',
  'contact_row_label',
  'contact_single',
  'contact_multi',
] as const;

export type SummaryRowsConfig = Record<(typeof SUMMARY_ROWS_KEYS)[number], string>;

type OccurrencePeriod = Pick<EventDataOccurrence, 'venue_label' | 'starts_on' | 'ends_on'>;

/**
 * 会場ごとに開始日か終了日が違うか。会場ごとの日程 (同じ会場の前期・後期はまとめて 1 つ) を比べる。
 * 日付の分からない会場・日付は比べない (分からないことを「違う」とは言えないため)。会場名の無い会場どうしも 1 つにまとめる (同じ理由)。
 * 見るのは event_data だけ。期間を抽出の開催期間で補ったときも、注記は event_data で日程の違いが分かったときだけ付ける
 */
export function periodsDiffer(occurrences: readonly OccurrencePeriod[]): boolean {
  const byVenue = new Map<string, { starts: Set<string>; ends: Set<string> }>();
  for (const o of occurrences) {
    const label = o.venue_label ?? '';
    if (!byVenue.has(label)) byVenue.set(label, { starts: new Set(), ends: new Set() });
    const venue = byVenue.get(label)!;
    if (o.starts_on) venue.starts.add(o.starts_on);
    if (o.ends_on) venue.ends.add(o.ends_on);
  }
  // 会場ごとの日付の組 (分かっている日付だけ) が 2 通り以上あれば、違う
  const differ = (pick: 'starts' | 'ends') => {
    const known = [...byVenue.values()].filter((v) => v[pick].size > 0);
    return new Set(known.map((v) => [...v[pick]].sort().join(','))).size > 1;
  };
  return differ('starts') || differ('ends');
}

/**
 * 「開催期間」のセル。期間は全会場の和集合 (`extractEventFactCardFields` の値。この記事のポイントと同じ) で、
 * 日付の書式は `01b-points.yaml` の rendered と同じ。終わりの分からないときだけ `period_open` で書く。
 * 会場ごとに日程が違えば `period_varies_note` を付ける。開始日が無ければ null (LLM の行をそのまま残す)
 */
export function renderSummaryPeriod(
  period: { start?: string; end?: string },
  occurrences: readonly OccurrencePeriod[],
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
  const store = representative.trim() || (venues.length === 1 ? venues[0].trim() : '');
  if (store) return fillTemplate(config.contact_single, { 代表店舗名: tableCell(escapeMdxText(store)) });
  return venues.length >= 2 ? config.contact_multi : null;
}

/** 表のセルとして安全にする (文言は YAML の固定文と日付だが、YAML に | が入っても表を壊さない) */
function cellOrNull(value: string | null): string | null {
  return value === null ? null : tableCell(value);
}

export interface SummaryRowsInput {
  /** 全体の開催期間 (`extractEventFactCardFields` の値) */
  period: { start?: string; end?: string };
  occurrences: readonly OccurrencePeriod[];
  /** `storeContext.代表店舗名` */
  representative: string;
  /** `storeContext.会場一覧` */
  venues: readonly string[];
  pointsFormat: PointsFormat;
  config: SummaryRowsConfig & { venue_row_label: string };
}

/**
 * まとめの表の「開催期間」と「お問い合わせ」を書く。値が作れない行は LLM の行のまま。
 * 行が無ければ、雛形の行の順 (開催場所 → 開催期間 → 地図 → お問い合わせ) で前にある行のうち、最も近い行の後ろに足す。
 * 書けなかった行の名前を `missing` に返す (前の行も無かったとき)
 */
export function applySummaryRows(content: string, input: SummaryRowsInput): { content: string; missing: string[] } {
  const { config } = input;
  const order = [config.venue_row_label, config.period_row_label, config.map_row_label, config.contact_row_label];
  const rows: Array<[label: string, value: string | null]> = [
    // event_data が無ければ抽出した開催期間 (この記事のポイントと同じ値)。開始日が分からなければ LLM の行のまま
    [config.period_row_label, cellOrNull(renderSummaryPeriod(input.period, input.occurrences, input.pointsFormat, config))],
    // 会場のデータも代表店舗名も無ければ、どちらの文言か決められないので LLM の行のまま
    [config.contact_row_label, cellOrNull(renderSummaryContact(input.representative, input.venues, config))],
  ];
  let result = content;
  const missing: string[] = [];
  for (const [label, value] of rows) {
    if (!label || !value) continue;
    // 行の名前が順の一覧に無い (設定の誤り) ときは足さない (置き換えだけ)
    const at = order.indexOf(label);
    const after = at > 0 ? order.slice(0, at).reverse() : [];
    const upserted = upsertSummaryRow(result, label, value, after);
    if (upserted.status === 'missing') missing.push(label);
    result = upserted.content;
  }
  return { content: result, missing };
}
