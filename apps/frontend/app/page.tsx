import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import Link from 'next/link';
import { getAllArticles } from '@/lib/mdx/articles';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';
import { SignupBenefit } from '@/components/molecules/SignupBenefit';

export const revalidate = 120; // ISR

export const metadata: Metadata = {
  title: 'Revolution — アニメ × イベント × 街 をめぐる、AI 編集メディア',
  description:
    'コラボカフェ、推し旅、ポップアップ。街と作品の交差点を、AI が編集する次世代イベントメディア。',
};

export default async function Home() {
  const articles = getAllArticles();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <Layout hidePt>
      <section className="w-main mx-auto pt-8 md:pt-14 lg:pt-16">
        <p className="font-numeric tabular-nums text-xs tracking-[0.22em] text-ink-muted uppercase">
          Vol. 01 — {yearMonth}
        </p>
        <SparkRule className="mt-2 mb-5 md:mb-6" width="3em" />
        {/* 改行はモバイル 3 行 / sm 以上 2 行に固定 (日本語の auto-break は不定なため文言変更時は要調整) */}
        <h1 className="font-display text-[1.75rem] leading-[1.35] text-ink-strong sm:text-4xl sm:leading-[1.25] md:text-[2.75rem] md:leading-[1.2] lg:text-[3.25rem]">
          アニメイベントは
          <br className="sm:hidden" />
          期間限定でも、
          <br />
          体験と思い出はタイムレス
        </h1>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-body md:mt-5 md:text-base">
          コラボカフェ、ポップアップ、コラボイベント。期間限定のアニメイベントを記録する
          WEB メディアです。
        </p>
      </section>

      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SectionHeader
          eyebrow="No. 001 / Articles"
          title="最新の記事"
          subtitle={`公開中: ${articles.length} 本`}
          action={
            articles.length > 1 ? (
              <Link
                href="/articles"
                className="font-display inline-flex items-center gap-1.5 text-sm tracking-wide text-primary-600 transition-colors hover:text-primary-700"
              >
                すべて見る
                <span aria-hidden="true">→</span>
              </Link>
            ) : undefined
          }
        />
        <PaginatedArticleGrid articles={articles} mode="button" />
      </section>

      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SignupBenefit />
      </section>

      <section id="about" className="w-main mx-auto mt-section-sp md:mt-section-pc scroll-mt-24">
        <SectionHeader eyebrow="No. 002 / About" title="Revolution とは" />
        <p className="max-w-prose text-base leading-relaxed text-ink-body md:text-lg">
          Revolution
          は、コラボカフェ・推し旅・ポップアップショップ・コラボグッズなど、
          作品と街が交わる「イベント」を AI
          が編集する次世代 Web メディアです。RSS から MDX
          まで、記事の生成と公開をパイプライン化し、編集者の意思とテクノロジーを掛け合わせて、最短で「いつ・どこで」を届けます。
        </p>
      </section>
    </Layout>
  );
}
