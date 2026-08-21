import type { ArticleIndexItem } from '@/lib/mdx/article-types';

/**
 * 記事 ⇄ 作品の紐付け (Layer 1、純粋関数)。
 *
 * ## 紐付けは「取り込みが解決済みの正準」を経由する (2026-08-21 BOSS 確定、案 X)
 *
 * 記事 frontmatter の `event_data.title_slugs` には **AI 出力のゆれ**が入り得る
 * (実例: `meitantei-conan`。titles マスタの正準は `detective-conan`)。ゆれの
 * 解決表 `title_aliases` は RLS で anon から読めない (2026-08-02 BOSS 確定の
 * 意図的非公開) ため、SSG ビルドで alias を再解決することはできない。
 *
 * 代わりに **`event_data.event_slug`** を使う。これは取り込み (ingest) の
 * upsert 自然キー = `events.slug` と同一の値で、取り込み時に
 * `title_aliases` で名寄せ済みの**正準 `title_id` が `event_titles` に張られて
 * いる**。つまり「作品の企画の `events.slug` 集合」(anon で読める) に記事の
 * `event_slug` が含まれるかを見れば、ゆれ入りの記事も正準の作品に紐づく。
 *
 * ## フォールバックは正準 slug の直接一致のみ
 *
 * まだ取り込まれていない記事 (企画が DB に無い) は `title_slugs` と正準 slug の
 * **直接一致**だけで拾う。ゆれた記事は取り込まれるまでハブに出ない —
 * これは「新規エンティティは人手承認まで公開しない」という取り込みの
 * verified ゲート (`docs/event-review-data-model.md` §8.2) と同じ思想。
 * 正規化照合 (`normalizeAlias`) を挟んでも `meitantei-conan` →
 * `detective-conan` のような語の違いは越えられないため、中途半端な救済は
 * 入れない。
 */

/**
 * この作品に属する記事を選ぶ。新しい順 (date 降順) で返す。
 *
 * @param eventSlugs - この作品の全企画の `events.slug` 集合 (DB 由来)
 * @param titleSlug - この作品の正準 slug (`titles.slug`)
 */
export function selectTitleArticles(
  articles: readonly ArticleIndexItem[],
  eventSlugs: ReadonlySet<string>,
  titleSlug: string,
): ArticleIndexItem[] {
  return articles
    .filter((article) => {
      const eventData = article.event_data;
      if (!eventData) return false;
      if (eventData.event_slug && eventSlugs.has(eventData.event_slug)) return true;
      return eventData.title_slugs.includes(titleSlug);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 記事一覧が持つカテゴリ slug (`event_data.primary_category_slug`) を
 * 出現順・重複なしで列挙する。`/titles/{slug}/articles/{category}` の
 * チップと `generateStaticParams` に使う。
 */
export function collectArticleCategorySlugs(articles: readonly ArticleIndexItem[]): string[] {
  const seen = new Set<string>();
  for (const article of articles) {
    const slug = article.event_data?.primary_category_slug;
    if (slug) seen.add(slug);
  }
  return [...seen];
}

/**
 * 1 カテゴリに属する記事の本数 (Claude Design v6 #17/#18 のチップの件数)。
 *
 * 絞り込みの述語は**カテゴリページ本体と同じ** `primary_category_slug` の一致。
 * ⚠️ ここが本体と食い違うと「チップは 3 と言っているのに開いたら 1 本」に
 *    なるため、判定は 1 つの式に揃える (`collectArticleCategorySlugs` が
 *    同じフィールドを見ているのと対)。
 */
export function countArticlesInCategory(
  articles: readonly ArticleIndexItem[],
  categorySlug: string,
): number {
  return articles.filter(
    (article) => article.event_data?.primary_category_slug === categorySlug,
  ).length;
}

/**
 * カテゴリ slug の表示名を記事から解決する。
 *
 * カテゴリの日本語名は記事 index では `event_title` (例: `コラボカフェ`) が
 * 持っている (`categories` 配列は作品名と混在するため使わない)。該当記事が
 * 表示名を持たなければ slug をそのまま出す (欠損で落とさない)。
 */
export function resolveCategoryLabel(
  articles: readonly ArticleIndexItem[],
  categorySlug: string,
): string {
  for (const article of articles) {
    if (article.event_data?.primary_category_slug === categorySlug && article.event_title) {
      return article.event_title;
    }
  }
  return categorySlug;
}

/** `event_titles` を平らにした (作品, 企画 slug) の対。 */
export type TitleEventSlugPair = {
  titleSlug: string;
  /** 作品の表示名。記事ページの作品チップをリンク化するときに使う。 */
  titleName: string;
  eventSlug: string;
};

/** 記事から作品ハブへ張るリンク。 */
export type TitleLink = {
  slug: string;
  name: string;
};

/**
 * 記事 1 本が属する正準作品を (slug, name) で解決する (Layer 1、純粋関数)。
 *
 * 解決順は `selectTitleArticles` と同じ 2 段:
 * 1. `event_data.event_slug` → 取り込み済みの `event_titles` (AI ゆれも正準に届く)
 * 2. 未取り込みの記事は `title_slugs` と正準 slug の直接一致のみ
 *
 * どちらでも解決できない記事は空配列 (リンクを出さない。ハブ側の
 * 「ゆれは取り込まれるまで出ない」と同じ思想)。
 */
export function resolveArticleTitleLinks(
  article: ArticleIndexItem,
  titles: readonly TitleLink[],
  pairs: readonly TitleEventSlugPair[],
): TitleLink[] {
  const eventData = article.event_data;
  if (!eventData) return [];

  const bySlug = new Map<string, TitleLink>();

  if (eventData.event_slug) {
    for (const pair of pairs) {
      if (pair.eventSlug === eventData.event_slug) {
        bySlug.set(pair.titleSlug, { slug: pair.titleSlug, name: pair.titleName });
      }
    }
  }

  const nameBySlug = new Map(titles.map((title) => [title.slug, title.name]));
  for (const slug of eventData.title_slugs) {
    const name = nameBySlug.get(slug);
    if (name !== undefined && !bySlug.has(slug)) {
      bySlug.set(slug, { slug, name });
    }
  }

  return [...bySlug.values()];
}

/**
 * `/titles/{slug}/articles/{category}` の `generateStaticParams` 用に、
 * 「記事が実在する (作品, カテゴリ)」の組を列挙する。
 *
 * 対象の作品は **titles マスタの slug のみ** (`titleSlugs`)。記事の
 * `title_slugs` にしか現れない slug (AI ゆれ等) はハブ自体が 404 になるため、
 * ここでも組を作らない。記事 0 件のカテゴリも生成しない (ページ側で
 * `notFound()` に倒すため、生成しても 404 になるだけ)。
 */
export function collectTitleCategoryParams(
  articles: readonly ArticleIndexItem[],
  titleSlugs: readonly string[],
  pairs: readonly TitleEventSlugPair[],
): { slug: string; category: string }[] {
  const eventSlugsByTitle = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const set = eventSlugsByTitle.get(pair.titleSlug);
    if (set) {
      set.add(pair.eventSlug);
    } else {
      eventSlugsByTitle.set(pair.titleSlug, new Set([pair.eventSlug]));
    }
  }

  const params: { slug: string; category: string }[] = [];
  for (const titleSlug of titleSlugs) {
    const eventSlugs = eventSlugsByTitle.get(titleSlug) ?? new Set<string>();
    const titleArticles = selectTitleArticles(articles, eventSlugs, titleSlug);
    for (const category of collectArticleCategorySlugs(titleArticles)) {
      params.push({ slug: titleSlug, category });
    }
  }
  return params;
}
