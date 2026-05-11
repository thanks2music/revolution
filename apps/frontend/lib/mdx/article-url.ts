import type { ArticleIndexItem } from './article-types';

/**
 * Pure URL builder. Lives in its own client-safe module so Client Components
 * can build article URLs without dragging the `fs`-using helpers in
 * `articles.ts` into the browser bundle.
 *
 * URL 設計: /{event_type}/{work_slug}/{slug}
 * 例: /collabo-cafe/sample-work/01kafsdmvd
 *
 * レガシー記事 (event_type='articles' or work_slug=null) は /articles/{slug}
 * にフォールバック。
 */
export function getArticleUrl(article: ArticleIndexItem): string {
  if (!article.event_type) {
    return `/articles/${article.slug}`;
  }

  if (article.event_type === 'articles' || !article.work_slug) {
    return `/articles/${article.slug}`;
  }

  return `/${article.event_type}/${article.work_slug}/${article.slug}`;
}
