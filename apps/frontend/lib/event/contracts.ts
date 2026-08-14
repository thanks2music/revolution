import { z } from 'zod';

/**
 * `events` / `titles` を読むときの契約と select 句 (真実源)。
 *
 * ## なぜ独立したモジュールなのか
 *
 * 開催詳細ページと企画ページの**両方**が `events` と `titles` を読む。
 * それぞれのファイルに zod と select 句を書くと、片方だけ列を足したときに
 * **契約と select が黙ってずれる**。`OCCURRENCE_COLUMNS` を共有したのと
 * 同じ理由で、events / titles も 1 箇所に置く
 * (PR #303 のレビュー指摘: 「events 側では共有目的が達成できていない」)。
 *
 * 依存の向きを一方向に保つため、`lib/occurrence/queries.ts` と
 * `lib/event/queries.ts` の**どちらからも import される葉モジュール**にしている
 * (企画 → 開催の依存があるので、共有物を企画側に置くと循環する)。
 *
 * ## snake_case → camelCase は select の別名で吸収する
 *
 * 列と契約の対応をここで閉じる。アプリ側で詰め替えると詰め替えコードが
 * 第 2 の契約になる。
 */

export const EventSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
});

export type Event = z.infer<typeof EventSchema>;

/** 上記に対応する PostgREST の select 句。 */
export const EVENT_COLUMNS = 'id, slug, name, description, officialUrl:official_url';

export const TitleSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

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
export const EventSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type EventSummary = z.infer<typeof EventSummarySchema>;
