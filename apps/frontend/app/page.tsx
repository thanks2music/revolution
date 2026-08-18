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
  title: 'アニイベ | 推し作品の体験と思い出を記録・レビュー・口コミ',
  description:
    '推し活イベントに行った体験・思い出を記録・レビュー・口コミできるアニイベ。コラボカフェやポップアップなど、アニメ・漫画・映画・音楽のイベント情報も掲載！',
};

export default async function Home() {
  const articles = getAllArticles();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <Layout hidePt>
      <section className="w-main mx-auto pt-8 md:pt-12 lg:pt-14">
        <p className="font-numeric tabular-nums text-xs tracking-[0.22em] text-ink-muted uppercase">
          Vol. 01 — {yearMonth}
        </p>
        <SparkRule className="mt-2 mb-4 md:mb-5" width="3em" />
        {/* 見出しではなくタグライン扱いの h1 */}
        <h1 className="font-display text-xl leading-snug text-ink-strong md:text-2xl lg:text-[1.75rem]">
          体験×推し=思い出
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-body md:mt-4 md:text-base">
          アニイベは、アニメ・漫画・音楽・映画などの推し活イベントで体験した思い出を記録・レビュー・口コミできるイベント情報サービスです。
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
        <SectionHeader eyebrow="No. 002 / About" title="アニイベとは" />
        <p className="max-w-prose text-base leading-relaxed text-ink-body md:text-lg">
          コラボカフェ・ポップアップ・コラボグッズなど、作品と街が交わるイベントを AI
          が集め、「いつ・どこで」を最短で届けます。そして、行った人が残した体験とレビューが、そこに積み重なっていきます。
        </p>
      </section>
    </Layout>
  );
}
