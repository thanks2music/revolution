import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import Link from 'next/link';
import { getAllArticles } from '@/lib/mdx/articles';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import { OngoingOccurrenceCard } from '@/components/molecules/OngoingOccurrenceCard';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';
import { SignupBenefit } from '@/components/molecules/SignupBenefit';
import { listOngoingOccurrences, pickOngoingTitles } from '@/lib/home/queries';
import { getTitleUrl } from '@/lib/title/title-url';
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
  // 開催中は rail とピックアップ作品の**両方**が使うので 1 回だけ引く
  // (`pickOngoingTitles` は純粋関数で、同じ `occurrence_view` を 2 周しない)。
  const ongoing = await listOngoingOccurrences();
  const titlePicks = pickOngoingTitles(ongoing);
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

        {/*
          ヒーロー (Claude Design v5 #1)。
          ⚠️ **写真は BOSS 支給待ち** (2026-08-22)。届いたら下の grid 背景を
             `next/image` に差し替える。写真が無くても「コピーが読める帯」として
             成立する形にしてあるので、支給前でもレイアウトは崩れない。
        */}
        <div className="relative mt-6 flex min-h-[12rem] items-end overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 to-ink-strong p-5 md:mt-8 md:min-h-[16rem] md:p-8">
          <p className="font-display text-xl font-black leading-snug text-white md:text-3xl">
            行ったイベントを、
            <br />
            ずっと残そう。
          </p>
        </div>
      </section>

      {/* 開催中 rail (v5 #1)。開催が 0 件のときはセクションごと出さない。 */}
      {ongoing.length > 0 && (
        <section className="mt-section-sp md:mt-section-pc">
          <div className="w-main mx-auto">
            <SectionHeader
              eyebrow="No. 001 / Now"
              title="開催中"
              subtitle={`いま行けるイベント ${ongoing.length} 件`}
            />
          </div>
          {/*
            横スクロールの rail。`w-main` の外へ出して**画面端まで**スクロールさせ、
            左右に `w-main` と同じ余白を作る (器の中で切ると窮屈になるため)。
            `snap-x` でカード単位に止まる。
          */}
          <ul className="rail">
            {ongoing.map((occurrence) => (
              <li key={occurrence.id} className="snap-start">
                <OngoingOccurrenceCard occurrence={occurrence} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SectionHeader
          eyebrow="No. 002 / Explore"
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

      {/*
        記事セクション (v5 #1)。**クリーム地の帯**で「読み物」であることを面ごと
        区別する (記事カード自体も同じトーン)。帯は画面幅いっぱいに敷き、
        中身だけ `w-main` に収める。
      */}
      <section className="mt-section-sp border-y border-article-line bg-article py-section-sp md:mt-section-pc md:py-section-pc">
        <div className="w-main mx-auto">
        <SectionHeader
          eyebrow="No. 003 / Articles"
          title="AIライターの記事"
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
        </div>
      </section>

      {/*
        ピックアップ作品 (v5 #1)。「いま開催中の作品を開催数の多い順に最大 10 件」
        (2026-08-22 BOSS 確定。v5 の 3 件固定はやめ、横スクロールで伸ばす)。
        開催中が 0 件ならセクションごと出さない。
      */}
      {titlePicks.length > 0 && (
        <section className="mt-section-sp md:mt-section-pc">
          <div className="w-main mx-auto">
            <SectionHeader
              eyebrow="No. 004 / Titles"
              title="いま開催中の作品"
              subtitle="開催中のイベントが多い作品から。"
              action={
                <Link
                  href="/titles"
                  className="font-display inline-flex items-center gap-1.5 text-sm tracking-wide text-primary-600 transition-colors hover:text-primary-700"
                >
                  すべての作品
                  <span aria-hidden="true">→</span>
                </Link>
              }
            />
          </div>
          <ul className="rail">
            {titlePicks.map((pick) => (
              <li key={pick.slug} className="snap-start">
                <Link
                  href={getTitleUrl(pick.slug)}
                  className="flex w-40 shrink-0 flex-col rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
                >
                  <span className="font-display font-bold leading-snug text-ink-strong">
                    {pick.name}
                  </span>
                  <span className="mt-1 text-xs text-ink-muted">
                    開催中{' '}
                    <span className="font-numeric tabular-nums">{pick.ongoingCount}</span> 件
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="w-main mx-auto mt-section-sp md:mt-section-pc">
        <SignupBenefit />
      </section>

      <section id="about" className="w-main mx-auto mt-section-sp md:mt-section-pc scroll-mt-24">
        <SectionHeader eyebrow="No. 005 / About" title="アニイベとは" />
        <p className="max-w-prose text-base leading-relaxed text-ink-body md:text-lg">
          コラボカフェ・ポップアップ・コラボグッズなど、作品と街が交わるイベントを AI
          が集め、「いつ・どこで」を最短で届けます。そして、行った人が残した体験とレビューが、そこに積み重なっていきます。
        </p>
      </section>
    </Layout>
  );
}
