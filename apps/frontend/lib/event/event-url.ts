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
 * URL 設計の確定内容は `docs/schema/revolution-article-meta.md` §3。
 * `events.slug` は URL に露出しない (企画名は不安定なため ID を正準にする)。
 */

/** 企画ページ。`/events/{id}` */
export function getEventUrl(eventId: number | string): string {
  return `/events/${eventId}`;
}

/**
 * 開催詳細ページ。`/events/{id}/{occurrence-slug}`
 *
 * `occurrence_slug` は企画スコープ内で一意 (`unique(event_id, slug)`) なので、
 * 企画 ID と組で初めて開催を特定できる。
 */
export function getOccurrenceUrl(eventId: number | string, occurrenceSlug: string): string {
  return `/events/${eventId}/${occurrenceSlug}`;
}
