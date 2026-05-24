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

/**
 * いいね識別子 (favorites.target_key) を記事から生成する Layer1 純粋関数。
 *
 * 軽量ポリモーフィック設計 (hashed-doodling-hopper.md §いいね識別子設計)。
 * Closed Beta は `target_type='article'` 固定で、target_key は
 * `event_type/work_slug/slug` の **URL path 連結キー** (先頭スラッシュなし)。
 *
 * slug 単独はグローバル一意でない (path 配下のみ一意) ため、`getArticleUrl` と
 * 同じ正規化ルールでキーを組み立てる:
 *   - 通常記事: `${event_type}/${work_slug}/${slug}`        (例: collabo-cafe/kusuriyanohitorigoto/dry-run-1)
 *   - レガシー記事 (event_type なし / 'articles' / work_slug なし): `articles/${slug}`
 *
 * `getArticleUrl(article)` の戻り値から先頭の `/` を 1 つ剥いだものと一致する。
 * URL とキーを 1 つの正規化ルールに集約することで、将来 canonicalKey が確定した際は
 * この関数 + 逆引き + migration の差し替えだけで吸収できる。
 */
export function buildArticleKey(
  article: Pick<ArticleIndexItem, 'slug' | 'event_type' | 'work_slug'>,
): string {
  if (!article.event_type || article.event_type === 'articles' || !article.work_slug) {
    return `articles/${article.slug}`;
  }
  return `${article.event_type}/${article.work_slug}/${article.slug}`;
}

/**
 * `buildArticleKey` が生成したキーを記事インデックスから逆引きする Layer1 純粋関数。
 *
 * - 通常記事 (`event_type/work_slug/slug` の 3 セグメント): event_type + work_slug +
 *   slug の 3 つ揃いで一意特定する (slug 単独の非一意性を回避)。
 * - レガシー記事 (`articles/{slug}` の 2 セグメント): slug で特定する。古いいいねや
 *   event_type 未設定記事のフォールバック。
 * - 該当なし / 不正なキー形式: null を返す (記事が削除された / キーが壊れている等)。
 *
 * I/O を持たず、呼び出し側 (マイページ Server Component) が渡す記事配列に対して
 * 走査する純粋関数。記事インデックスの読み込み (`fs`) は呼び出し側の責務に留め、
 * 本モジュールを client-safe に保つ。
 */
export function resolveArticleByKey<T extends Pick<ArticleIndexItem, 'slug' | 'event_type' | 'work_slug'>>(
  key: string,
  articles: readonly T[],
): T | null {
  if (!key) return null;

  const segments = key.split('/');

  // レガシー: articles/{slug}
  if (segments.length === 2 && segments[0] === 'articles') {
    const slug = segments[1];
    return articles.find((a) => buildArticleKey(a) === key || a.slug === slug) ?? null;
  }

  // 通常: event_type/work_slug/slug — buildArticleKey で再構築して厳密一致させる
  // (3 つ揃いの一意性を担保。slug 単独一致には頼らない)。
  return articles.find((a) => buildArticleKey(a) === key) ?? null;
}
