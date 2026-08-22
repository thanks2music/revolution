/**
 * 作品の記事一覧のカテゴリ絞り込み `/titles/{slug}/articles/{category}`
 * (集約ビュー、URL 設計 §7。例 `/titles/jujutsu-kaisen/articles/collabo-cafe`)
 *
 * `{category}` は **slug** (`event_data.primary_category_slug`)。記事 index の
 * `categories` 配列は日本語表示名 (作品名と混在) なので URL には使わない。
 *
 * 該当記事が 0 本の組はページとして成立しない (`generateStaticParams` も
 * 記事が実在する組しか列挙しない) ため `notFound()` に倒す。
 */

import { CATEGORY_SLUG_REGEX } from '@revolution/schemas/category';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CategoryChip } from '@/components/molecules/CategoryChip';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import Layout from '@/components/templates/Layout';
import { getAllArticles } from '@/lib/mdx/articles';
import { generateContentMetadata } from '@/lib/metadata';
import {
  collectArticleCategorySlugs,
  collectTitleCategoryParams,
  countArticlesByCategory,
  resolveCategoryLabel,
  selectTitleArticles,
} from '@/lib/title/article-links';
import { getTitleHubData, listTitleEventSlugPairs, listTitleParams } from '@/lib/title/queries';
import {
  getTitleArticlesCategoryUrl,
  getTitleArticlesUrl,
  getTitleUrl,
} from '@/lib/title/title-url';
import type { PageProps } from '@/types/page-props';

export const revalidate = 120;

type TitleArticleCategoryPageProps = PageProps<{ slug: string; category: string }>;

export async function generateStaticParams() {
  // ネストした動的セグメントは親の params を受け取れないので、ここで
  // (作品, カテゴリ) の組を自前で列挙する。組み立ては Layer 1
  // (`collectTitleCategoryParams`) に寄せ、ここは入力の取得だけを行う。
  const [titleParams, pairs] = await Promise.all([listTitleParams(), listTitleEventSlugPairs()]);
  return collectTitleCategoryParams(
    getAllArticles(),
    titleParams.map((param) => param.slug),
    pairs,
  );
}

/** ページ本体と generateMetadata で同じ絞り込みを行う。 */
async function loadCategoryArticles(slug: string, category: string) {
  // カテゴリ slug の表記ゆれ (`Collabo-Cafe` 等) を DB へ投げる前に 404 へ。
  if (!CATEGORY_SLUG_REGEX.test(category)) return null;

  const data = await getTitleHubData(slug);
  if (!data) return null;

  const articles = selectTitleArticles(getAllArticles(), data.eventSlugs, data.title.slug);
  const filtered = articles.filter(
    (article) => article.event_data?.primary_category_slug === category,
  );
  if (filtered.length === 0) return null;

  return { title: data.title, articles, filtered };
}

export async function generateMetadata(props: TitleArticleCategoryPageProps): Promise<Metadata> {
  const { slug, category } = await props.params;
  const loaded = await loadCategoryArticles(slug, category);

  if (!loaded) {
    return { title: '記事が見つかりません' };
  }

  const label = resolveCategoryLabel(loaded.filtered, category);
  return generateContentMetadata({
    title: `${loaded.title.name} の${label}記事一覧`,
    description: `${loaded.title.name} の${label}に関する記事一覧です。`,
    path: getTitleArticlesCategoryUrl(loaded.title.slug, category),
  });
}

export default async function TitleArticleCategoryPage(props: TitleArticleCategoryPageProps) {
  const { slug, category } = await props.params;
  const loaded = await loadCategoryArticles(slug, category);

  if (!loaded) notFound();

  const { title, articles, filtered } = loaded;
  const categorySlugs = collectArticleCategorySlugs(articles);
  // チップの件数は 1 周でまとめて数える (カテゴリごとに filter しない)。
  const categoryCounts = countArticlesByCategory(articles);
  const label = resolveCategoryLabel(filtered, category);

  return (
    <Layout>
      <div className="mx-auto w-main py-section-sp md:py-section-pc">
        <nav aria-label="パンくず" className="mb-6 text-sm text-ink-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:underline">
                ホーム
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <Link href={getTitleUrl(title.slug)} className="hover:underline">
                {title.name}
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <Link href={getTitleArticlesUrl(title.slug)} className="hover:underline">
                記事一覧
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{label}</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          {title.name} の{label}記事
        </h1>
        <p className="mb-6 text-sm text-ink-muted">
          <span className="font-numeric tabular-nums">{filtered.length}</span> 本 / 全{' '}
          <span className="font-numeric tabular-nums">{articles.length}</span> 本中
        </p>

        <div className="mb-8 flex flex-wrap gap-2">
          <CategoryChip
            name="すべて"
            href={getTitleArticlesUrl(title.slug)}
            size="md"
            count={articles.length}
          />
          {categorySlugs.map((categorySlug) => (
            <CategoryChip
              key={categorySlug}
              name={resolveCategoryLabel(articles, categorySlug)}
              href={getTitleArticlesCategoryUrl(title.slug, categorySlug)}
              active={categorySlug === category}
              size="md"
              count={categoryCounts.get(categorySlug) ?? 0}
            />
          ))}
        </div>

        <PaginatedArticleGrid
          key={`${title.slug}/${category}`}
          articles={filtered}
          mode="infinite"
        />
      </div>
    </Layout>
  );
}
