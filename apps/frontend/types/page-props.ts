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
 * Article page params for new route structure
 *
 * @description
 * Used in /[event_type]/[work_slug]/[slug] route
 *
 * @example
 * // URL: /collabo-cafe/sample-work/01kafsdmvd
 * {
 *   event_type: 'collabo-cafe',
 *   work_slug: 'sample-work',
 *   slug: '01kafsdmvd'
 * }
 */
export type ArticlePageParamsNew = {
  event_type: string;
  work_slug: string;
  slug: string;
};

/**
 * Occurrence (開催) detail page params
 *
 * @description
 * Used in /events/[id]/[occurrence_slug] route.
 * `id` is the event (企画) ID; `occurrence_slug` identifies the venue-scoped
 * occurrence within that event. URL 設計は 2026-08-03 確定
 * (`docs/event-review-data-model.md` §7)。events.slug は URL に露出しない。
 *
 * @example
 * // URL: /events/2/tokyo-shibuya
 * { id: '2', occurrence_slug: 'tokyo-shibuya' }
 */
export type OccurrencePageParams = {
  id: string;
  occurrence_slug: string;
};

/**
 * Page props for legacy article pages
 *
 * @description
 * Used in /articles/[slug]/page.tsx and /articles/[slug]/opengraph-image.tsx
 */
export type ArticlePageProps = PageProps<ArticlePageParams>;

/** Page props for the occurrence detail page. */
export type OccurrencePageProps = PageProps<OccurrencePageParams>;

/**
 * Page props for new article pages
 *
 * @description
 * Used in /[event_type]/[work_slug]/[slug]/page.tsx
 * and /[event_type]/[work_slug]/[slug]/opengraph-image.tsx
 */
export type ArticlePagePropsNew = PageProps<ArticlePageParamsNew>;
