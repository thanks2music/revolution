import { EventSchema as EventRowSchema } from '@revolution/schemas/event';
import { TitleSchema as TitleRowSchema, type TITLE_KIND_VALUES } from '@revolution/schemas/title';
import { z } from 'zod';

/**
 * 作品ハブ (`/titles/{slug}`) が `titles` / `event_titles` を読むときの契約と
 * select 句。方針は `lib/event/contracts.ts` と同じ:
 * **契約 (zod) は `shared/schemas/` の SSoT から `.pick()` で派生させ、
 * frontend に残すのは PostgREST 固有の select 句と埋め込みの取り出しだけ。**
 *
 * `lib/event/contracts.ts` の `TitleSchema` ({slug, name}) はパンくず用の最小
 * 契約なのでそのまま残し、ここではハブの表示に要る列 (name_kana / kind) まで
 * 含む別契約を持つ。同名衝突を避けるため `TitleDetail` と呼ぶ。
 */

/** 作品ハブの見出しに使う列だけに絞った契約。 */
export const TitleDetailSchema = TitleRowSchema.pick({
  slug: true,
  name: true,
  nameKana: true,
  kind: true,
});

export type TitleDetail = z.infer<typeof TitleDetailSchema>;

/** 上記に対応する PostgREST の select 句 (別名で camelCase へ揃える)。 */
export const TITLE_DETAIL_COLUMNS = 'slug, name, nameKana:name_kana, kind';

/**
 * `kind` の表示ラベル。`Record` で `TITLE_KIND_VALUES` との網羅一致を強制する
 * (kind を追加してここを忘れるとコンパイルエラー)。
 */
export const TITLE_KIND_LABELS: Record<(typeof TITLE_KIND_VALUES)[number], string> = {
  anime: 'アニメ',
  manga: '漫画',
  game: 'ゲーム',
  novel: '小説',
  other: 'その他',
};

/**
 * kind → 表示ラベル。契約上 `kind` は string (zod は enum を refine しない) なので、
 * 未知の値はそのまま出す (落とさない。DB CHECK が許容値を守っている前提)。
 */
export function titleKindLabel(kind: string): string {
  return (TITLE_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/**
 * 作品に紐づく企画。一覧カードと集計 (レビュー件数 Σ rating_count) に要る列だけ。
 *
 * `slug` は URL には出さない (`lib/event/event-url.ts` 参照) が、**記事との
 * 紐付けキー**として使う: 記事 frontmatter の `event_data.event_slug` は
 * 取り込み (ingest) の upsert 自然キー = `events.slug` と一致する。
 */
export const TitleEventSchema = EventRowSchema.pick({
  id: true,
  slug: true,
  name: true,
  ratingCount: true,
});

export type TitleEvent = z.infer<typeof TitleEventSchema>;

/**
 * `event_titles` 経由で「この作品の企画」を引く select 句。
 * `titles!inner` は `.eq('titles.slug', …)` のフィルタを効かせるためだけに
 * 埋め込む (取り出しには使わない)。
 */
export const TITLE_EVENT_COLUMNS =
  'events!inner(id, slug, name, ratingCount:rating_count), titles!inner(slug)';

/**
 * `event_titles` の埋め込み結果から企画だけを取り出す。
 *
 * `!inner` でも契約上は null を許して落とす (`parseEmbeddedTitles` と同じ防御)。
 * 複数作品コラボの企画が別作品側の行として重複することはない
 * (`titles.slug` で 1 作品に絞って引くため) が、**同一企画の重複行**は
 * データ不整合時に備えて id で畳む。
 */
export function parseEmbeddedTitleEvents(data: unknown): TitleEvent[] {
  const rows = z
    .array(z.object({ events: TitleEventSchema.nullable() }))
    .parse(data ?? [])
    .map((row) => row.events)
    .filter((event): event is TitleEvent => event !== null);

  const byId = new Map<number, TitleEvent>();
  for (const event of rows) {
    byId.set(event.id, event);
  }
  return [...byId.values()];
}
