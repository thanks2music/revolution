import { cache } from 'react';
import { z } from 'zod';

import {
  attachVenueNames,
  OCCURRENCE_COLUMNS,
  OccurrenceDetailSchema,
  type OccurrenceListItem,
} from '@/lib/occurrence/queries';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 企画 (event) の読み取り。
 *
 * ## occurrence 側から再利用しているもの
 *
 * `OCCURRENCE_COLUMNS` / `OccurrenceDetailSchema` / `attachVenueNames` は
 * 開催詳細ページと共有する。**列・契約・会場名の解決規則を 2 箇所に持たない**
 * ことが目的で、片方だけ列を足したときに zod と select がずれるのを防ぐ。
 *
 * 依存の向きは 企画 → 開催。企画ページは開催の一覧を出す画面なので自然な向き。
 *
 * ## S2 の時点で作らないもの
 *
 * デザイン (`docs/plan/2026-08-02-mvp-design-implementation-gap-and-task-breakdown.md` §43)
 * は 6 ブロックを要求するが、**3 つはデータ源が存在しない** (2026-08-14 実測):
 *
 * | ブロック | 状況 |
 * |---|---|
 * | 評価サマリ (平均 / 件数 / 分布) | `reviews` 0 件。**S4** の範囲 |
 * | 全会場共通情報タブ | **`event_attributes` テーブルが存在しない** (A-3-a の migration 未完) |
 * | この企画の記事 | `article-index.json` に企画を特定する項目が無い (`event_slug` も `event_id` も持たない)。紐付けは canonicalKey 再設計を伴う **S3** の範囲 |
 *
 * 依存が揃った時点で足す。
 */

const EventSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
});

const TitleSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

const EventSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type EventPageData = {
  event: z.infer<typeof EventSchema>;
  titles: z.infer<typeof TitleSchema>[];
  /** この企画のすべての開催 (会場名を解決済み)。グルーピングは表示側で行う。 */
  occurrences: OccurrenceListItem[];
  /** 同じ作品に紐づく他の企画 (自分を除く)。 */
  relatedEvents: z.infer<typeof EventSummarySchema>[];
};

const EVENT_COLUMNS = 'id, slug, name, description, officialUrl:official_url';

/**
 * `generateStaticParams` 用。開催を 1 件以上持つ企画の ID を列挙する。
 *
 * 開催が 0 件の企画はページを出しても「会場を選ぶ」が空になるだけなので、
 * 静的生成の対象にしない (オンデマンドでは到達できる)。
 *
 * 資格情報が無いビルドで 0 件を返す理由は
 * `lib/supabase/public.ts` の `hasPublicSupabaseCredentials` を参照。
 */
export async function listEventParams(): Promise<{ id: string }[]> {
  if (!hasPublicSupabaseCredentials()) {
    console.warn(
      '[event] Supabase の公開接続情報が無いため、企画ページの静的生成をスキップしました ' +
        '(資格情報を持たないビルドでは想定どおり)。ページは実行時にオンデマンド生成されます。',
    );
    return [];
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.from('occurrence_view').select('eventId:event_id');

  if (error) {
    throw new Error(`failed to list event params: ${error.message}`);
  }

  const rows = z.array(z.object({ eventId: z.number() })).parse(data ?? []);
  // 同じ企画が開催数だけ出てくるので畳む。
  return [...new Set(rows.map((row) => row.eventId))].map((id) => ({ id: String(id) }));
}

/**
 * 企画詳細 1 件 + 表示に要る周辺データ。見つからなければ null。
 *
 * `React.cache()` でリクエスト内メモ化する (`generateMetadata` とページ本体の
 * 両方から同じ引数で呼ばれるため。理由は `lib/occurrence/queries.ts` の
 * `getOccurrenceDetail` と同じ)。
 */
export const getEventDetail = cache(async function getEventDetail(
  eventIdRaw: string,
): Promise<EventPageData | null> {
  const eventId = Number(eventIdRaw);
  if (!Number.isInteger(eventId) || eventId <= 0) return null;

  const supabase = createPublicClient();

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`failed to load event: ${eventError.message}`);
  }
  if (!eventRow) return null;

  const event = EventSchema.parse(eventRow);

  const [titleResult, occurrenceResult] = await Promise.all([
    supabase.from('event_titles').select('titles(slug, name)').eq('event_id', eventId),
    supabase.from('occurrence_view').select(OCCURRENCE_COLUMNS).eq('event_id', eventId),
  ]);

  // ⚠️ error を見ないと「クエリが落ちた」が「該当 0 件」と区別できず、
  //    実在する開催が黙って消える。PR #302 で同じ穴を踏んでいる。
  for (const [label, result] of [
    ['titles', titleResult],
    ['occurrences', occurrenceResult],
  ] as const) {
    if (result.error) {
      throw new Error(`failed to load ${label}: ${result.error.message}`);
    }
  }

  const titles = z
    .array(z.object({ titles: TitleSchema.nullable() }))
    .parse(titleResult.data ?? [])
    .map((row) => row.titles)
    .filter((t): t is z.infer<typeof TitleSchema> => t !== null);

  const occurrences = await attachVenueNames(
    z.array(OccurrenceDetailSchema).parse(occurrenceResult.data ?? []),
  );

  return {
    event,
    titles,
    occurrences,
    relatedEvents: await findRelatedEvents(eventId, titles.map((t) => t.slug)),
  };
});

/**
 * 同じ作品に紐づく他の企画。作品が 1 つも無ければ空配列。
 *
 * `event_titles` を作品 slug 側から引き直す。**自分自身は除く**。
 */
async function findRelatedEvents(
  eventId: number,
  titleSlugs: string[],
): Promise<z.infer<typeof EventSummarySchema>[]> {
  if (titleSlugs.length === 0) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('event_titles')
    .select('events(id, name), titles!inner(slug)')
    .in('titles.slug', titleSlugs);

  if (error) {
    throw new Error(`failed to load related events: ${error.message}`);
  }

  const rows = z
    .array(z.object({ events: EventSummarySchema.nullable() }))
    .parse(data ?? []);

  // 複数作品に紐づく企画は重複して返るので畳む。
  const byId = new Map<number, z.infer<typeof EventSummarySchema>>();
  for (const row of rows) {
    if (row.events && row.events.id !== eventId) {
      byId.set(row.events.id, row.events);
    }
  }
  return [...byId.values()];
}
