/**
 * 企画 / 開催の URL 生成 (Layer 1、純粋関数)。
 *
 * ## なぜヘルパを置くのか
 *
 * このリポジトリには **記事 URL について名前付きヘルパを置く慣習**が既にある
 * (`lib/mdx/article-url.ts` の `getArticleUrl`。docstring は「URL とキーを 1 つの
 * 正規化ルールに集約する」と明言し、`app/sitemap.ts` もそれを呼んでいる)。
 *
 * 企画・開催だけがその慣習の外にあり、テンプレートリテラルが 8 箇所へ散っていた
 * (sitemap 2 / 企画ページ 3 / 開催詳細ページ 3)。`lib/route-params.ts` が
 * 「正準形は 1 つだけであるべき」という強い立場を取っているのに、
 * **生成側に正準形の定義が無い**という非対称になっていた。
 *
 * ## URL の形 (2026-11-03 改訂)
 *
 * 第 1 階層はイベント種別 (`events.primary_category_id` が指す `categories.slug`)。
 * 旧形式 `/events/{id}` はドメイン (anime-events.com) と "events" が重なるため移した。
 *
 * | ページ | URL |
 * |---|---|
 * | 種別の企画一覧 | `/{種別}` (例 `/collabo-cafe`) |
 * | 企画 | `/{種別}/{id}` |
 * | 開催 | `/{種別}/{id}/{occurrence-slug}` |
 *
 * **識別子は今も ID**。種別は分類の接頭辞で、主分類が変わったときはページ側が
 * 正しい URL へ転送する (`app/[event_type]/[id]/page.tsx`)。`events.slug` は
 * 今も URL に露出しない (企画名は不安定なため)。
 * 設計の正本は `one-more-time/docs/event-review-data-model.md` §7。
 */

/**
 * 企画の URL を組み立てるのに要る最小の形。
 *
 * PostgREST の埋め込み `primaryCategory:categories!primary_category_id(slug, ...)` の
 * 結果を**詰め替えずにそのまま渡せる**形にしてある。種別を渡し忘れると型で止まる。
 */
export type EventRouteRef = {
  id: number | string;
  primaryCategory: { slug: string };
};

/** 種別の企画一覧。`/{種別}` */
export function getEventTypeUrl(categorySlug: string): string {
  return `/${categorySlug}`;
}

/** 企画ページ。`/{種別}/{id}` */
export function getEventUrl(event: EventRouteRef): string {
  return `${getEventTypeUrl(event.primaryCategory.slug)}/${event.id}`;
}

/**
 * 開催詳細ページ。`/{種別}/{id}/{occurrence-slug}`
 *
 * `occurrence_slug` は企画スコープ内で一意 (`unique(event_id, slug)`) なので、
 * 企画 ID と組で初めて開催を特定できる。
 */
export function getOccurrenceUrl(event: EventRouteRef, occurrenceSlug: string): string {
  return `${getEventUrl(event)}/${occurrenceSlug}`;
}
