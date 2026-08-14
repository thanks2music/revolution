import type { ArticleIndexItem } from './article-types';

/**
 * 記事 URL とキーの純粋関数。Client Component からも使えるよう、`fs` を使う
 * `articles.ts` とは別モジュールに置いている。
 *
 * ## URL 設計: `/articles/{post_id}` の 1 本のみ (2026-08-14 移行)
 *
 * 旧設計は `/{event_type}/{work_slug}/{slug}` の 3 セグメントで、レガシー記事だけ
 * `/articles/{slug}` へフォールバックしていた。**この 3 セグメント形は廃止した。**
 *
 * - 記事の識別子は `post_id` (= `slug`、`ai-writer` の `template-generator` で同値)
 * - 後方互換の redirect は**張らない** (2026-08-02 確定 D8)。根拠は「実運用未開始で
 *   影響ゼロ」であり、実測でも記事 5 件は全て `dry-run-*` = 守るべき正準 URL が 1 件もない
 * - 企画・作品・会場は `/events/{id}` `/titles/{slug}` `/venues/{slug}` を持つ。
 *   記事 URL に `event_type` / `work_slug` を含めると、**同じ情報が 2 つの URL 体系に
 *   跨って重複する**
 */
export function getArticleUrl(article: Pick<ArticleIndexItem, 'slug'>): string {
  return `/articles/${article.slug}`;
}

/**
 * いいね識別子 (`favorites.target_key`) を記事から生成する Layer1 純粋関数。
 *
 * 軽量ポリモーフィック設計 (`target_type` + `target_key`)。Closed Beta は
 * `target_type='article'` 固定。
 *
 * ## 形式: `articles/{post_id}`
 *
 * `getArticleUrl(article)` の戻り値から先頭の `/` を 1 つ剥いだものと一致する
 * (URL とキーを 1 つの正規化ルールに集約する、という当初の設計意図は維持)。
 *
 * ## ⚠️ まだ URL と結合している (別フィーチャーで切る予定)
 *
 * `articles/` プレフィックスは URL パスの名残であって、キーとして必要な情報では
 * ない (`target_type` が既に名前空間を担っている)。**URL 設計が動くとキーも動く**
 * という結合は残っている。
 *
 * この結合を切る (`target_key` を opaque な ID にする) 計画は
 * `one-more-time/docs/schema/favorites-opaque-key-plan.md` にあり、
 * **別フィーチャーで深掘りしてから着手する** (2026-08-14 BOSS)。
 * 移行対象は 0 件 (`favorites` は staging / production とも空) なので、
 * この中間状態にデータ上のリスクはない。
 */
export function buildArticleKey(article: Pick<ArticleIndexItem, 'slug'>): string {
  return `articles/${article.slug}`;
}

/**
 * `buildArticleKey` が生成したキーを記事インデックスから逆引きする Layer1 純粋関数。
 *
 * ## 厳密一致のみ (2026-08-14 に legacy フォールバックを削除)
 *
 * 旧実装は「3 セグメントキーの厳密一致 → 2 セグメント (`articles/{slug}`) の
 * legacy フォールバック」の 2 段構えだった。URL が `/articles/{post_id}` の 1 本に
 * なったことで **`buildArticleKey` は全記事に対して `articles/{slug}` を返す**ため、
 * legacy フォールバックは厳密一致が拾えないものを 1 つも拾えない = 到達不能になった。
 *
 * 到達不能な分岐を残すと「何のための分岐か」が失われた死んだコードになるため削除した
 * (2026-08-14 BOSS 承認)。旧 3 セグメント形式のキーは `favorites` に 1 件も存在しない
 * (staging / production とも 0 件を実測)。
 *
 * I/O を持たず、呼び出し側 (マイページ Server Component) が渡す記事配列に対して
 * 走査する純粋関数。記事インデックスの読み込み (`fs`) は呼び出し側の責務に留め、
 * 本モジュールを client-safe に保つ。
 *
 * @returns 該当記事、または該当なし / 不正なキーのとき null
 */
export function resolveArticleByKey<T extends Pick<ArticleIndexItem, 'slug'>>(
  key: string,
  articles: readonly T[],
): T | null {
  if (!key) return null;
  return articles.find((article) => buildArticleKey(article) === key) ?? null;
}
