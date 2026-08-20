import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import Link from 'next/link';
import { getAllArticles } from '@/lib/mdx/articles';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';
import { SignupBenefit } from '@/components/molecules/SignupBenefit';
import { siteConfig } from '@/lib/metadata';

export const revalidate = 120; // ISR

// トップは root layout と同一セグメントのため `title.template` が適用されない。
// 他ページと違いサイト名を自分で持つ必要があるので、リテラルではなく
// `siteConfig.name` から組み立てて供給元を 1 本に保つ。
//
// 語順が他ページと逆 (トップ = サイト名が先 / 他 = `%s | サイト名` で後) なのは
// 意図的。トップはブランド名で検索された時の受け皿なので先頭に置き、
// 下層はページ固有の内容を先頭に置いて一覧での識別性を優先する。
export const metadata: Metadata = {
  title: `${siteConfig.name} | 推し作品の体験と思い出を記録・レビュー・口コミ`,
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
          eyebrow="No. 001 / Explore"
          title="探す"
          subtitle="作品・企画・会場ごとに、開催情報とレビューを集約しています。"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/titles"
            className="block border border-[var(--line-soft)] bg-bg-elevated p-6 transition-colors hover:border-[var(--line-strong)]"
          >
            <span className="font-display text-lg font-bold text-ink-strong">作品から探す</span>
            <p className="mt-2 text-sm leading-relaxed text-ink-body">
              推し作品のイベント、いま何がやってる？ 作品ごとの開催・記事のまとめへ。
            </p>
          </Link>
          <Link
            href="/events"
            className="block border border-[var(--line-soft)] bg-bg-elevated p-6 transition-colors hover:border-[var(--line-strong)]"
          >
            <span className="font-display text-lg font-bold text-ink-strong">企画から探す</span>
            <p className="mt-2 text-sm leading-relaxed text-ink-body">
              コラボカフェなどの企画ごとに、全会場の開催情報へ。
            </p>
          </Link>
          <Link
            href="/venues"
            className="block border border-[var(--line-soft)] bg-bg-elevated p-6 transition-colors hover:border-[var(--line-strong)]"
          >
            <span className="font-display text-lg font-bold text-ink-strong">会場から探す</span>
            <p className="mt-2 text-sm leading-relaxed text-ink-body">
              行きたい会場・近くの会場で、いま何がやってる？ 会場ごとの開催情報へ。
            </p>
          </Link>
        </div>
      </section>

      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SectionHeader
          eyebrow="No. 002 / Articles"
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
        <SectionHeader eyebrow="No. 003 / About" title="アニイベとは" />
        <p className="max-w-prose text-base leading-relaxed text-ink-body md:text-lg">
          コラボカフェ・ポップアップ・コラボグッズなど、作品と街が交わるイベントを AI
          が集め、「いつ・どこで」を最短で届けます。そして、行った人が残した体験とレビューが、そこに積み重なっていきます。
        </p>
      </section>
    </Layout>
  );
}
