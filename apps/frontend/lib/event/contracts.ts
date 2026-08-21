import { CategorySchema as CategoryRowSchema } from '@revolution/schemas/category';
import { EventSchema as EventRowSchema } from '@revolution/schemas/event';
import { TitleSchema as TitleRowSchema } from '@revolution/schemas/title';
import { z } from 'zod';

/**
 * `events` / `titles` を読むときの契約と select 句。
 *
 * ## 契約は `shared/schemas/` の SSoT から派生させる
 *
 * Schema-SDD では **zod が真実源で、境界スキーマは `shared/schemas/` に置く**
 * (`llm-context/development-principles.md` §Schema-SDD)。`shared/schemas/event.ts`
 * と `title.ts` は `createSelectSchema(events)` / `createSelectSchema(titles)` で
 * **Drizzle のテーブル定義から自動導出**されている。
 *
 * ここで `z.object({...})` を手書きすると、列の nullability が二重管理になる。
 * 例えば `description` を NOT NULL 化する migration を打つと shared 側と ai-writer は
 * 追随するが、**手書き側だけ `string | null` を主張し続ける**。
 *
 * `.pick()` で必要な列だけに絞るのは `lib/occurrence/queries.ts` が
 * `OccurrenceViewSchema.pick({...})` でやっているのと同じ形。
 *
 * ## frontend に残すのは PostgREST 固有のものだけ
 *
 * select 句 (`EVENT_COLUMNS` 等) と埋め込み結果の取り出し
 * (`parseEmbeddedTitles`) は PostgREST の都合なので frontend の関心。
 * **契約 (zod) は shared、クエリの書き方は frontend** という分割にしている。
 */

/** 企画。ページ表示に使う列だけに絞った契約。 */
export const EventSchema = EventRowSchema.pick({
  id: true,
  slug: true,
  name: true,
  description: true,
  officialUrl: true,
});

export type Event = z.infer<typeof EventSchema>;

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const EVENT_COLUMNS = 'id, slug, name, description, officialUrl:official_url';

/** 作品。パンくずと導線に使う列だけ。 */
export const TitleSchema = TitleRowSchema.pick({ slug: true, name: true });

export type Title = z.infer<typeof TitleSchema>;

/** `event_titles` 経由で作品を引くときの select 句 (FK があるので埋め込みが効く)。 */
export const EVENT_TITLES_COLUMNS = 'titles(slug, name)';

/**
 * `event_titles` の埋め込み結果から作品だけを取り出す。
 *
 * 埋め込みは `{ titles: null }` を返し得る (FK 先が消えている等) ので、
 * **null を落としてから**使う。
 */
export function parseEmbeddedTitles(data: unknown): Title[] {
  return z
    .array(z.object({ titles: TitleSchema.nullable() }))
    .parse(data ?? [])
    .map((row) => row.titles)
    .filter((title): title is Title => title !== null);
}

/** 一覧・リンク用の最小の企画情報。 */
export const EventSummarySchema = EventRowSchema.pick({ id: true, name: true });

export type EventSummary = z.infer<typeof EventSummarySchema>;

/**
 * `/events` 一覧カード (Claude Design v6 #14) が読む企画の行。
 *
 * ## `EventSummarySchema` を拡張せず別契約にした理由
 *
 * `EventSummary` は `findRelatedEvents` (企画詳細の「同じ作品の他の企画」) が
 * 使っており、あちらは名前とリンクだけで足りる。共通の契約を太らせると
 * **使わない列を取得・検証するコード**が関連企画側に生えるため分けている。
 *
 * ## 埋め込みは 2 経路
 *
 * - **イベントタイプ** = `events.primary_category_id` → `categories`
 * - **作品** = `event_titles` → `titles` (M:N、複数作品コラボがあり得る)
 *
 * どちらも埋め込みは `null` を返し得る (FK 先が消えている等) ので契約上許し、
 * 取り出し側で落とす (`parseEmbeddedTitles` と同じ防御)。
 */
export const EventListRowSchema = EventRowSchema.pick({ id: true, name: true }).extend({
  /** 主分類 (イベントタイプ)。`primary_category_id` は NOT NULL FK なので実運用では非 null。 */
  primaryCategory: CategoryRowSchema.pick({ name: true }).nullable(),
  /** この企画に紐づく作品。開催 0 件の企画は一覧に載らないが、作品 0 件はあり得る。 */
  eventTitles: z.array(z.object({ titles: TitleSchema.nullable() })),
});

/**
 * 上記に対応する PostgREST の select 句。
 *
 * 🔴 **`categories(name)` と素朴に書くと 300 PGRST201 で落ちる** (2026-08-22 実測)。
 * `events` と `categories` の間には関係が **2 経路**あるため:
 *
 * | 経路 | 由来 |
 * |---|---|
 * | `events_primary_category_id_categories_id_fk` (many-to-one) | `events.primary_category_id` |
 * | `event_categories` (many-to-many) | 補助タグ用の中間テーブル |
 *
 * PostgREST は曖昧参照を**エラーにする** (黙ってどちらかを選ばない) ので、
 * `!primary_category_id` で経路を明示する。**ここを消すと `/events` が 500 になる。**
 *
 * 補助タグ (`event_categories`) は決定 ⑨ で MVP スコープ外なので読まない。
 */
export const EVENT_LIST_COLUMNS =
  'id, name, primaryCategory:categories!primary_category_id(name), eventTitles:event_titles(titles(slug, name))';

/**
 * 埋め込み結果から作品名だけを取り出す (Layer 1、純粋関数)。
 *
 * 並び順は `localeCompare('ja')`。**DB 任せにしない** — 埋め込みの行順は
 * 保証されておらず、ビルドごとにチップの並びが変わると差分がノイズになる。
 * 同名の別作品は実在しない (`titles.name` は名寄せ済み) が、`slug` で
 * タイブレークして安定させる。
 */
export function parseEmbeddedEventTitles(
  eventTitles: { titles: Title | null }[],
): Title[] {
  return eventTitles
    .map((row) => row.titles)
    .filter((title): title is Title => title !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.slug.localeCompare(b.slug));
}
