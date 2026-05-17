import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import { getAllArticles, getAllCategories } from '@/lib/mdx/articles';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { CategoryChip } from '@/components/molecules/CategoryChip';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';

export const revalidate = 120; // ISR (home と同じ 2 分)

export const metadata: Metadata = {
  title: 'すべての記事 — Revolution',
  description:
    'Revolution の記事一覧。コラボカフェ・推し旅・ポップアップショップ等のイベント情報。',
};

type SearchParams = { category?: string | string[] };

const ALL_LABEL = 'すべて';

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolved = (await searchParams) ?? {};
  const rawCategory = Array.isArray(resolved.category)
    ? resolved.category[0]
    : resolved.category;
  const activeCategory = rawCategory?.trim() || null;

  const allArticles = getAllArticles();
  const categories = getAllCategories();
  const articles = activeCategory
    ? allArticles.filter((article) => article.categories.includes(activeCategory))
    : allArticles;

  return (
    <Layout hidePt>
      {/* Page header */}
      <section className="w-main mx-auto pt-12 md:pt-16">
        <p className="font-numeric tabular-nums text-xs tracking-[0.22em] text-ink-muted uppercase">
          Index — Articles
        </p>
        <SparkRule className="mt-2 mb-7" width="3em" />
        <h1 className="font-display text-4xl leading-tight text-ink-strong sm:text-5xl md:text-6xl">
          すべての記事
        </h1>
        <p className="mt-5 text-sm text-ink-muted">
          <span className="font-numeric tabular-nums">{articles.length}</span> 本
          {activeCategory && (
            <span className="font-numeric tabular-nums"> / 全 {allArticles.length} 本中</span>
          )}
          <span className="mx-2 text-[var(--line-strong)]">/</span>
          <span className="font-numeric tabular-nums">{categories.length}</span> カテゴリ
        </p>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
          <SectionHeader
            eyebrow="No. 001 / Categories"
            title="カテゴリ"
            subtitle="興味のあるテーマから記事を探す。"
          />
          <div className="flex flex-wrap gap-2">
            <CategoryChip
              name={ALL_LABEL}
              href="/articles"
              active={!activeCategory}
              size="md"
            />
            {categories.map((category) => (
              <CategoryChip
                key={category}
                name={category}
                href={`/articles?category=${encodeURIComponent(category)}`}
                active={category === activeCategory}
                size="md"
              />
            ))}
          </div>
        </section>
      )}

      {/* All articles */}
      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SectionHeader
          eyebrow="No. 002 / All"
          title={activeCategory ? `${activeCategory} の記事` : '記事一覧'}
          subtitle={
            activeCategory
              ? `カテゴリ「${activeCategory}」で絞り込み中: ${articles.length} 本`
              : `新着順に ${articles.length} 本を表示しています。`
          }
        />
        {/*
          key={activeCategory ?? 'all'} で remount し、カテゴリ切替時に visibleCount を
          初期化する (React 公式 "Resetting all state when a prop changes" 準拠)。
          PaginatedArticleGrid 側で useEffect による setState を避けるため、
          リセットの責務は parent に集約する。
        */}
        <PaginatedArticleGrid
          key={activeCategory ?? 'all'}
          articles={articles}
          mode="infinite"
        />
      </section>
    </Layout>
  );
}
