import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import { getAllArticles, getAllCategories } from '@/lib/mdx/articles';
import { ArticleGrid } from '@/components/organisms/ArticleGrid';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { CategoryChip } from '@/components/molecules/CategoryChip';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';

export const revalidate = 120; // ISR (home と同じ 2 分)

export const metadata: Metadata = {
  title: 'すべての記事 — Revolution',
  description:
    'Revolution の記事一覧。コラボカフェ・推し旅・ポップアップショップ等のイベント情報。',
};

export default function ArticlesPage() {
  const articles = getAllArticles();
  const categories = getAllCategories();

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
            {categories.map((category) => (
              <CategoryChip key={category} name={category} size="md" />
            ))}
          </div>
        </section>
      )}

      {/* All articles */}
      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SectionHeader
          eyebrow="No. 002 / All"
          title="記事一覧"
          subtitle={`新着順に ${articles.length} 本を表示しています。`}
        />
        <ArticleGrid articles={articles} layout="grid" />
      </section>
    </Layout>
  );
}
