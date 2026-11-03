import { EventSchema as EventRowSchema } from '@revolution/schemas/event';
import { OccurrenceViewSchema } from '@revolution/schemas/occurrence';
import { VenueSchema as VenueRowSchema } from '@revolution/schemas/venue';
import { z } from 'zod';

import { PRIMARY_CATEGORY_EMBED, PrimaryCategorySchema } from '@/lib/event/contracts';

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
 * 会場ページから見た開催に埋め込む企画。カード表示とリンク先 (`/{種別}/{id}/…`)
 * に要る列だけ。
 */
const VenueOccurrenceEventSchema = EventRowSchema.pick({
  id: true,
  name: true,
}).extend({ primaryCategory: PrimaryCategorySchema });

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
   * 契約上は null を許す。**null の行は `toVenueOccurrences` が落とす**
   * (企画の種別が分からないとリンク先の URL を作れない)。
   */
  events: VenueOccurrenceEventSchema.nullable(),
});

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const VENUE_OCCURRENCE_COLUMNS =
  `id, eventId:event_id, slug, startsOn:starts_on, endsOn:ends_on, status, events(id, name, ${PRIMARY_CATEGORY_EMBED})`;

type VenueOccurrenceRow = z.infer<typeof VenueOccurrenceRowSchema>;

/** 表示用の開催。企画を解決済み (non-null) で持つ。 */
export type VenueOccurrence = Omit<VenueOccurrenceRow, 'events'> & {
  events: NonNullable<VenueOccurrenceRow['events']>;
  /** 企画の表示名 (`events.name`)。並び替えのタイブレークにも使う。 */
  eventName: string;
};

/**
 * 取得結果を表示用の形へ。企画の解決を通す唯一の入口。
 *
 * 企画が引けない行は落とす。種別が分からないとリンク先の URL を作れないため
 * (種別を URL に入れる前も、企画の無い開催ページは 404 だった)。
 */
export function toVenueOccurrences(data: unknown): VenueOccurrence[] {
  return z
    .array(VenueOccurrenceRowSchema)
    .parse(data ?? [])
    .flatMap(({ events, ...row }) =>
      events === null ? [] : [{ ...row, events, eventName: events.name }],
    );
}
