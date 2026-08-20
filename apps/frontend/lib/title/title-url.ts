/**
 * 作品ハブの URL 生成 (Layer 1、純粋関数)。
 *
 * `lib/event/event-url.ts` / `lib/mdx/article-url.ts` と同じ慣習で、
 * 正準形の定義を生成側の 1 箇所に集約する。URL 設計は
 * `docs/event-review-data-model.md` §7 (作品ハブは集約ビューで、
 * 一覧に載る item の canonical は本拠地 `/events/…` / `/articles/…` を指す)。
 */

/** 作品ハブ。`/titles/{slug}` */
export function getTitleUrl(titleSlug: string): string {
  return `/titles/${titleSlug}`;
}

/** 作品の記事一覧 (集約ビュー)。`/titles/{slug}/articles` */
export function getTitleArticlesUrl(titleSlug: string): string {
  return `/titles/${titleSlug}/articles`;
}

/** 作品の記事一覧のカテゴリ絞り込み。`/titles/{slug}/articles/{category}` */
export function getTitleArticlesCategoryUrl(titleSlug: string, categorySlug: string): string {
  return `/titles/${titleSlug}/articles/${categorySlug}`;
}

/** 作品の開催一覧 (集約ビュー)。`/titles/{slug}/occurrences` */
export function getTitleOccurrencesUrl(titleSlug: string): string {
  return `/titles/${titleSlug}/occurrences`;
}
