import { EventSchema as EventRowSchema } from '@revolution/schemas/event';
import { OccurrenceViewSchema } from '@revolution/schemas/occurrence';
import { VenueSchema as VenueRowSchema } from '@revolution/schemas/venue';
import { z } from 'zod';

/**
 * 会場ページ (`/venues/{slug}`) が `venues` / `occurrence_view` を読むときの
 * 契約と select 句。方針は `lib/title/contracts.ts` と同じ:
 * **契約 (zod) は `shared/schemas/` の SSoT から `.pick()` で派生させ、
 * frontend に残すのは PostgREST 固有の select 句と埋め込みの取り出しだけ。**
 *
 * ## 読まない列とその理由
 *
 * - `geo`: PostGIS は SELECT 時に EWKB 16 進文字列を返す (WKT ではない、
 *   `shared/schemas/db/venues.ts` の注記)。表示には `ST_AsText` 相当の変換
 *   (RPC or view) が要るため MVP では読まない (2026-08-21 BOSS 確定。将来の
 *   地図 iframe は住所文字列で埋め込めるので geo は前提にならない)
 * - `createdAt`: zod 側が `Date` を期待する一方 PostgREST は ISO 文字列を返す
 *   (`lib/occurrence/queries.ts` と同じ罠)。ページが使わない列なので契約ごと絞る
 * - `venue_aliases`: anon から 0 行 (RLS `USING (false)`、2026-08-02 BOSS 確定)。
 *   SSG では出せないため**このモジュールから触らない**
 */

/** 会場ページの見出し・住所ブロックに使う列だけに絞った契約。 */
export const VenueDetailSchema = VenueRowSchema.pick({
  id: true,
  slug: true,
  name: true,
  prefecture: true,
  city: true,
  address: true,
});

export type VenueDetail = z.infer<typeof VenueDetailSchema>;

/**
 * 上記に対応する PostgREST の select 句。
 * venues の対象列はすべて 1 語 (snake = camel) なので別名は不要。
 * `id` は開催の絞り込みキー (`occurrences.venue_id`) として内部で使う。
 */
export const VENUE_DETAIL_COLUMNS = 'id, slug, name, prefecture, city, address';

/**
 * 会場ページから見た開催に埋め込む企画。カード表示とリンク先 (`/events/{id}/…`)
 * に要る列だけ。
 */
const VenueOccurrenceEventSchema = EventRowSchema.pick({
  id: true,
  name: true,
});

/**
 * 会場ページが読む開催の行。`lib/occurrence/queries.ts` の `OccurrenceRowSchema`
 * と対になる形だが、**venues の埋め込みは持たず events を埋め込む** — 会場は
 * ページ自身であり定数、行ごとに要るのは企画名の方だから。`venue_label` も
 * 読まない (全行が会場マスタに紐づく行なので `resolveVenueName` の出番がない)。
 */
export const VenueOccurrenceRowSchema = OccurrenceViewSchema.pick({
  id: true,
  eventId: true,
  slug: true,
  startsOn: true,
  endsOn: true,
  status: true,
}).extend({
  /**
   * 企画の埋め込み。`event_id` は NOT NULL FK + events は anon 公開なので
   * 実運用で null にはならないが、`parseEmbeddedTitleEvents` と同じ防御で
   * 契約上は null を許す。
   */
  events: VenueOccurrenceEventSchema.nullable(),
});

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const VENUE_OCCURRENCE_COLUMNS =
  'id, eventId:event_id, slug, startsOn:starts_on, endsOn:ends_on, status, events(id, name)';

/**
 * 企画名が解決できないときの表示。
 * ⚠️ **slug で代用しない。** slug は URL 用の識別子であって人が読む名前ではない
 * (`OccurrenceCard.tsx` の `VENUE_NAME_FALLBACK` と同じ規則)。
 */
export const EVENT_NAME_FALLBACK = '企画情報なし';

/** 表示用の開催。企画名を解決済みで持つ。 */
export type VenueOccurrence = z.infer<typeof VenueOccurrenceRowSchema> & {
  /** 解決済みの企画表示名。埋め込みが null なら `EVENT_NAME_FALLBACK`。 */
  eventName: string;
};

/** 取得結果を表示用の形へ。企画名の解決を通す唯一の入口。 */
export function toVenueOccurrences(data: unknown): VenueOccurrence[] {
  return z
    .array(VenueOccurrenceRowSchema)
    .parse(data ?? [])
    .map((row) => ({ ...row, eventName: row.events?.name ?? EVENT_NAME_FALLBACK }));
}
