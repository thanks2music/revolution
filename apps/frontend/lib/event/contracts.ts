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
