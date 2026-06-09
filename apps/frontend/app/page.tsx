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
      <section className="w-main mx-auto pt-12 md:pt-20 lg:pt-24">
        <p className="font-numeric tabular-nums text-xs tracking-[0.22em] text-ink-muted uppercase">
          Vol. 01 — {yearMonth}
        </p>
        <SparkRule className="mt-2 mb-7 md:mb-9" width="3em" />
        <h1 className="font-display text-[2.75rem] leading-[1.05] text-ink-strong sm:text-5xl md:text-6xl lg:text-7xl">
          体験は、
          <br />
          街で起きて、
          <br />
          ここに残す。
        </h1>
        <p className="mt-7 max-w-prose text-base leading-relaxed text-ink-body md:text-lg">
          コラボカフェ、ポップアップ、コラボイベント。
          <br />
          SNS では流れてしまう「あの日の体験」を、ひとつのページに刻む。
          <br />
          期間限定のアニメイベントを扱う、新しい WEB メディアです。
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
