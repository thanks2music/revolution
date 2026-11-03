/**
 * Common page props types for Next.js 16+ App Router
 *
 * @description
 * Centralized type definitions for async page parameters and search parameters.
 * Next.js 16 requires params to be awaited as Promise.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/page
 * @see https://nextjs.org/docs/messages/sync-dynamic-apis
 */

/**
 * Base page props with async params
 *
 * @template TParams - The type of the params object
 */
export type PageProps<TParams = Record<string, string>> = {
  params: Promise<TParams>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * Article page params for legacy route structure
 *
 * @description
 * Used in /articles/[slug] route
 *
 * @example
 * // URL: /articles/01kafsdmvd
 * { slug: '01kafsdmvd' }
 */
export type ArticlePageParams = {
  slug: string;
};

/**
 * Event (企画) page params
 *
 * @description
 * Used in /[event_type]/[id] route. `event_type` is the event's primary
 * category slug (`categories.slug`) and `id` is the event ID. The ID is the
 * identifier; when `event_type` does not match, the page redirects to the
 * canonical URL. URL 設計は 2026-11-03 改訂
 * (`docs/event-review-data-model.md` §7)。events.slug は URL に露出しない。
 *
 * @example
 * // URL: /collabo-cafe/2
 * { event_type: 'collabo-cafe', id: '2' }
 */
export type EventPageParams = {
  event_type: string;
  id: string;
};

/**
 * Occurrence (開催) detail page params
 *
 * @description
 * Used in /[event_type]/[id]/[occurrence_slug] route.
 * `occurrence_slug` identifies the venue-scoped occurrence within that event.
 *
 * @example
 * // URL: /collabo-cafe/2/tokyo-shibuya
 * { event_type: 'collabo-cafe', id: '2', occurrence_slug: 'tokyo-shibuya' }
 */
export type OccurrencePageParams = EventPageParams & {
  occurrence_slug: string;
};

/**
 * Page props for article pages
 *
 * @description
 * Used in /articles/[slug]/page.tsx and /articles/[slug]/opengraph-image.tsx.
 * 2026-08-14 の URL 移行で **記事のルートはこれ 1 本のみ**になった
 * (旧 `/[event_type]/[work_slug]/[slug]` は廃止)。
 */
export type ArticlePageProps = PageProps<ArticlePageParams>;

/** Page props for the event page. */
export type EventPageProps = PageProps<EventPageParams>;

/** Page props for the occurrence detail page. */
export type OccurrencePageProps = PageProps<OccurrencePageParams>;

