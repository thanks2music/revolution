/**
 * 作品の記事一覧 `/titles/{slug}/articles` (集約ビュー、URL 設計 §7)
 *
 * 各記事の canonical は本拠地 `/articles/{ULID}`。カテゴリ絞り込みは
 * サイト全体の `/articles?category=` (検索パラメータ) と違い、
 * **パスセグメント** `/titles/{slug}/articles/{category}` を持つ (§7 の表どおり。
 * 例 `/titles/jujutsu-kaisen/articles/collabo-cafe`)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CategoryChip } from '@/components/molecules/CategoryChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import Layout from '@/components/templates/Layout';
import { getAllArticles } from '@/lib/mdx/articles';
import { generateContentMetadata } from '@/lib/metadata';
import {
  collectArticleCategorySlugs,
  countArticlesByCategory,
  resolveCategoryLabel,
  selectTitleArticles,
} from '@/lib/title/article-links';
import { getTitleHubData, listTitleParams } from '@/lib/title/queries';
import {
  getTitleArticlesCategoryUrl,
  getTitleArticlesUrl,
  getTitleUrl,
} from '@/lib/title/title-url';
import type { PageProps } from '@/types/page-props';

export const revalidate = 120;

type TitleArticlesPageProps = PageProps<{ slug: string }>;

export async function generateStaticParams() {
  // 記事 0 本でも空状態を通常状態として描く (ハブと同じ集合を生成する)。
  return listTitleParams();
}

export async function generateMetadata(props: TitleArticlesPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) {
    return { title: '作品情報が見つかりません' };
  }

  return generateContentMetadata({
    title: `${data.title.name} の記事一覧`,
    description: `${data.title.name} のイベント・コラボ情報の記事一覧です。`,
    path: getTitleArticlesUrl(data.title.slug),
  });
}

export default async function TitleArticlesPage(props: TitleArticlesPageProps) {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) notFound();

  const { title, eventSlugs } = data;
  const articles = selectTitleArticles(getAllArticles(), eventSlugs, title.slug);
  const categorySlugs = collectArticleCategorySlugs(articles);
  // チップの件数は 1 周でまとめて数える (カテゴリごとに filter しない)。
  const categoryCounts = countArticlesByCategory(articles);

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
              <span aria-current="page">記事一覧</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          {title.name} の記事
        </h1>
        <p className="mb-6 text-sm text-ink-muted">
          <span className="font-numeric tabular-nums">{articles.length}</span> 本
        </p>

        {categorySlugs.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <CategoryChip
              name="すべて"
              href={getTitleArticlesUrl(title.slug)}
              active
              size="md"
              count={articles.length}
            />
            {categorySlugs.map((categorySlug) => (
              <CategoryChip
                key={categorySlug}
                name={resolveCategoryLabel(articles, categorySlug)}
                href={getTitleArticlesCategoryUrl(title.slug, categorySlug)}
                size="md"
                count={categoryCounts.get(categorySlug) ?? 0}
              />
            ))}
          </div>
        )}

        {articles.length > 0 ? (
          <PaginatedArticleGrid key={title.slug} articles={articles} mode="infinite" />
        ) : (
          <EmptyState message="この作品の記事はまだありません。" />
        )}
      </div>
    </Layout>
  );
}
