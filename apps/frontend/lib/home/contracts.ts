import { CategorySchema as CategoryRowSchema } from '@revolution/schemas/category';
import { EventSchema as EventRowSchema } from '@revolution/schemas/event';
import { OccurrenceViewSchema } from '@revolution/schemas/occurrence';
import { TitleSchema as TitleRowSchema } from '@revolution/schemas/title';
import { VenueSchema as VenueRowSchema } from '@revolution/schemas/venue';
import { z } from 'zod';

/**
 * トップページ (`/`) が読む契約と select 句。方針は `lib/event/contracts.ts` と同じ:
 * **契約 (zod) は `shared/schemas/` の SSoT から `.pick()` で派生させ、
 * frontend に残すのは PostgREST 固有の select 句と埋め込みの取り出しだけ。**
 *
 * ## トップだけが持つ形 = 「開催」から企画・作品・会場を一度に引く
 *
 * 下層ページは「1 企画の開催」「1 会場の開催」のように**軸が固定**されているが、
 * トップの開催中 rail は軸が無く、1 枚のカードに
 * **作品 / イベントタイプ / 企画名 / 会場 / 期間 / 残日数**が同居する
 * (Claude Design v5 #1)。そのため `occurrence_view` を起点に 3 階層の埋め込みを行う。
 *
 * ⚠️ **3 階層の埋め込み (`occurrence_view` → `events` → `event_titles` → `titles`)
 *    は実測で動く** (2026-08-22、staging の anon key で確認)。view 越しでも
 *    PostgREST が基底テーブルの FK を辿れるため。
 *
 * ## 読まない列とその理由 (v5 #1 にあるが MVP では描けないもの)
 *
 * - `event photo`: `occurrences` に画像列が無い
 * - 星評価: `OCCURRENCE_COLUMNS` と同じく rating を取らない (レビュー UI は S4)
 * - 補助タグ (「物販あり」「要予約」): `event_attributes` は決定 ⑨ で MVP スコープ外
 */

/** 開催中 rail のカードに埋め込む会場。住所行 (`東京都 渋谷 / 渋谷パルコ`) に使う。 */
const RailVenueSchema = VenueRowSchema.pick({
  slug: true,
  name: true,
  prefecture: true,
  city: true,
});

/** 同カードに埋め込む企画。タイプタグと作品チップを従える。 */
const RailEventSchema = EventRowSchema.pick({ id: true, name: true }).extend({
  primaryCategory: CategoryRowSchema.pick({ name: true }).nullable(),
  eventTitles: z.array(
    z.object({ titles: TitleRowSchema.pick({ slug: true, name: true }).nullable() }),
  ),
});

/** 開催中 rail が読む開催の行。 */
export const OngoingOccurrenceRowSchema = OccurrenceViewSchema.pick({
  id: true,
  eventId: true,
  slug: true,
  startsOn: true,
  endsOn: true,
}).extend({
  /** 会場マスタを持たない開催 (オンライン / 一時会場) では null。 */
  venues: RailVenueSchema.nullable(),
  /** `event_id` は NOT NULL FK だが、埋め込みの契約上は null を許して落とす。 */
  events: RailEventSchema.nullable(),
});

/**
 * 上記に対応する PostgREST の select 句。
 *
 * 🔴 `categories(name)` を素朴に書くと `300 PGRST201` (曖昧参照) で落ちる。
 * `events` と `categories` には `primary_category_id` の FK と `event_categories`
 * の M:N で 2 経路あるため、**`!primary_category_id` で経路を明示する**
 * (`lib/event/contracts.ts` の `EVENT_LIST_COLUMNS` と同じ罠)。
 *
 * ⚠️ `status` は読まない。**`status = 'ongoing'` で絞った結果しか扱わない**ので
 *    行ごとに持つ意味がなく、契約から外して「読んでいる列 = 検証している列」に揃える。
 */
export const ONGOING_OCCURRENCE_COLUMNS =
  'id, eventId:event_id, slug, startsOn:starts_on, endsOn:ends_on, ' +
  'venues(slug, name, prefecture, city), ' +
  'events(id, name, primaryCategory:categories!primary_category_id(name), eventTitles:event_titles(titles(slug, name)))';

/** 作品チップ 1 個。`lib/event/contracts.ts` の `Title` と同じ形。 */
export type RailTitle = { slug: string; name: string };

/** 表示用の開催中カード 1 枚。埋め込みの解決を済ませた形。 */
export type OngoingOccurrence = {
  /** `/events/{eventId}/{slug}` のリンク用。 */
  id: number;
  eventId: number;
  slug: string;
  startsOn: string | null;
  endsOn: string | null;
  /** 企画名。解決できなければ `EVENT_NAME_FALLBACK`。 */
  eventName: string;
  /** イベントタイプ (主分類)。解決できなければ null。 */
  categoryName: string | null;
  /** 作品チップ (名前順)。0 件もあり得る。 */
  titles: RailTitle[];
  /** 会場表示名。会場マスタが無ければ null (v5 の住所行ごと出さない)。 */
  venueName: string | null;
  /** 「東京都 渋谷区」。両方 null なら空文字。 */
  venueRegion: string;
};
