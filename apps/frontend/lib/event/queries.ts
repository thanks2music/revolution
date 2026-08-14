import { cache } from 'react';
import { z } from 'zod';

import {
  EVENT_COLUMNS,
  EVENT_TITLES_COLUMNS,
  EventSchema,
  EventSummarySchema,
  type EventSummary,
  parseEmbeddedTitles,
  type Title,
} from '@/lib/event/contracts';
import {
  attachVenueNames,
  OCCURRENCE_COLUMNS,
  OccurrenceDetailSchema,
  type OccurrenceListItem,
} from '@/lib/occurrence/queries';
import { parseCanonicalId } from '@/lib/route-params';
import { fetchAllRows } from '@/lib/supabase/paginate';
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

export type EventPageData = {
  event: z.infer<typeof EventSchema>;
  titles: Title[];
  /** この企画のすべての開催 (会場名を解決済み)。グルーピングは表示側で行う。 */
  occurrences: OccurrenceListItem[];
  /** 同じ作品に紐づく他の企画 (自分を除く)。 */
  relatedEvents: EventSummary[];
};

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

  // ⚠️ 単発 select にしない。PostgREST は `db.max_rows` で**エラーなしに**打ち切る。
  //    ここは「全件列挙」が前提の関数なので、打ち切られると静的生成から無言で漏れる。
  //    詳細は `lib/supabase/paginate.ts`。
  const rows = z.array(z.object({ eventId: z.number() })).parse(
    await fetchAllRows({
      label: 'event params',
      fetchPage: (from, to) =>
        supabase
          .from('occurrence_view')
          .select('eventId:event_id')
          .order('event_id', { ascending: true })
          .range(from, to),
    }),
  );

  // 同じ企画が開催数だけ出てくるので畳む。Set は挿入順を保つので
  // order の昇順がそのまま残り、ビルドごとにパス順が変わらない。
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
  // 表記ゆれ (`2.0` / `0x2` / `02` …) を 404 にする。理由は `lib/route-params.ts`。
  const eventId = parseCanonicalId(eventIdRaw);
  if (eventId === null) return null;

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
    supabase.from('event_titles').select(EVENT_TITLES_COLUMNS).eq('event_id', eventId),
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

  const titles = parseEmbeddedTitles(titleResult.data);

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
 *
 * ## 空ページへリンクしない (PR #303 レビュー指摘)
 *
 * 公開済み (`verified`) の開催を 1 件も持たない企画は、ページを開いても
 * 「会場を選ぶ」が空になる。**リンクを踏んだ先が空**という体験を作らないため、
 * 開催を持つ企画だけに絞る。`listEventParams` が静的生成の対象を
 * 「開催を 1 件以上持つ企画」に限っているのと同じ基準に揃えている。
 *
 * ## 件数と順序を明示する
 *
 * 人気作品では関連企画が大量に付き得る。`limit` も `order` も付けないと
 * **全件を DB 任せの順序で描画**してしまい、表示順がビルドごとに変わる。
 */

/**
 * 関連企画の表示上限。
 *
 * 「同じ作品の他の企画」は回遊のための補助導線であって一覧ではない。
 * 全件を出したい要求が生まれたら作品ハブ (`/titles/{slug}`) の役目になる。
 */
const RELATED_EVENTS_LIMIT = 12;

async function findRelatedEvents(eventId: number, titleSlugs: string[]): Promise<EventSummary[]> {
  if (titleSlugs.length === 0) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('event_titles')
    .select('events!inner(id, name), titles!inner(slug)')
    .in('titles.slug', titleSlugs)
    // 表示順を DB 任せにしない。名前順なら実行ごとに変わらない。
    .order('name', { ascending: true, referencedTable: 'events' })
    // 自分自身が混ざるので 1 件多く取ってから除外する。
    .limit(RELATED_EVENTS_LIMIT + 1);

  if (error) {
    throw new Error(`failed to load related events: ${error.message}`);
  }

  const rows = z.array(z.object({ events: EventSummarySchema.nullable() })).parse(data ?? []);

  // 複数作品に紐づく企画は重複して返るので畳む。Map は挿入順を保つので
  // 上の order がそのまま残る。
  const byId = new Map<number, EventSummary>();
  for (const row of rows) {
    if (row.events && row.events.id !== eventId) {
      byId.set(row.events.id, row.events);
    }
  }
  if (byId.size === 0) return [];

  return withPublishedOccurrences([...byId.values()]);
}

/**
 * 公開済みの開催を 1 件以上持つ企画だけを残す。順序は入力のまま。
 *
 * `occurrence_view` は anon から読むと `verified = true` の行しか返らないので、
 * 「返ってきた event_id の集合」がそのまま「公開できる企画」になる。
 */
async function withPublishedOccurrences(events: EventSummary[]): Promise<EventSummary[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('occurrence_view')
    .select('eventId:event_id')
    .in(
      'event_id',
      events.map((event) => event.id),
    );

  if (error) {
    throw new Error(`failed to check related events for occurrences: ${error.message}`);
  }

  const withOccurrences = new Set(
    z
      .array(z.object({ eventId: z.number() }))
      .parse(data ?? [])
      .map((row) => row.eventId),
  );

  return events.filter((event) => withOccurrences.has(event.id)).slice(0, RELATED_EVENTS_LIMIT);
}
