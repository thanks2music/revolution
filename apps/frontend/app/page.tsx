import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getAllArticles } from '@/lib/mdx/articles';
import { PaginatedArticleGrid } from '@/components/organisms/PaginatedArticleGrid';
import { OngoingOccurrenceCard } from '@/components/molecules/OngoingOccurrenceCard';
import { SectionHeader } from '@/components/molecules/SectionHeader';
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

  return (
    <Layout hidePt>
      {/*
        ヒーロー (Claude Design v5 #1 + 2026-08-22 BOSS 指示)。

        ## フルブリード (画面幅いっぱい)

        Filmarks の構造を参照した BOSS 指示。**背景写真はブラウザ幅いっぱいに敷き、
        読ませる文言だけを `w-main` に収める**。`Layout` の `<main>` に幅制約が
        無いので、このセクションだけ `w-main` を外せばフルブリードになる。

        ## 背景は「テクスチャ」として扱う

        文字の可読性のために全面を暗く落とすので、**元から暗い写真**でないと
        濁ってしまう (2026-08-22 に 3 案を同条件で比較し、明るい会場写真は
        暗色化すると濁ったベージュになることを確認)。現在の写真は暗い通路の
        カットで、赤の温かみが残るものを選んでいる。

        匿名化は**全面の一様なぼかし**で済ませてある (背景テクスチャなので
        部分マスクが不要になり、人物も展示物も確実に判別不能になる)。

        ⚠️ **写真を差し替えたら必ずコントラストを再計測する**
           (`visibility: hidden` で文字を隠し、背景だけを測ること。白い太字を
           含めたまま測ると文字自体を「背景の最も明るい点」として拾ってしまう)。
      */}
      <section className="relative isolate flex min-h-[19rem] items-end overflow-hidden md:min-h-[26rem]">
        {/*
          ⚠️ **仮入れの写真** (2026-08-22)。BOSS が加工版を用意中で、
             差し替え時は `public/images/hero-provisional.jpg` を置き換える
             (`.next` の画像最適化キャッシュが効くので `rm -rf .next` も必要)。
          フルブリードなので `sizes` は常に 100vw。`priority` は LCP 候補だから。
        */}
        <Image
          src="/images/hero-provisional.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />
        {/*
          全面のスクリム。フルブリードでは文言が画像のどこに重なるか
          (ビューポート幅次第で) 決まらないため、**左右や上下に振らず一様に落とす**。

          🔴 **色は `black` を使う。`ink-strong` ではない。** `--ink-strong` は
             16 進値を持つ CSS 変数なので、Tailwind の透明度修飾子が
             `rgb(var(--ink-strong) / .55)` を生成しようとして**無効になり、
             スクリムが丸ごと透明に潰れる** (2026-08-22 実測)。
        */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/60" />
        {/* 下端は次セクションへ繋ぐため、もう一段落とす。 */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/60 to-transparent to-55%"
        />

        <div className="w-main mx-auto py-10 md:py-14">
          {/* 見出しではなくタグライン扱いの h1 (PR #275 の判断を継承)。 */}
          <h1 className="font-display text-xl font-black leading-snug text-white md:text-3xl lg:text-[2rem]">
            体験×推し=思い出
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-white/95 md:mt-4 md:text-base">
            アニイベは、アニメ・漫画・音楽・映画などの推し活イベントで体験した思い出を記録・レビュー・口コミできるイベント情報サービスです。
          </p>
        </div>
      </section>

      {/*
        ⚠️ ここだけ通常のセクション間隔 (`mt-section-*` = 3.5rem / 7rem) を使わない。
        v5 #1 はヒーローの直下に探す導線を**密着**させて 1 つのブロックとして
        見せており、間隔を空けるとファーストビューから探す導線が押し出される
        (2026-08-22 BOSS 指摘「開催中はファーストビューから下げる / 探すを置く」)。
      */}
      <section className="w-main mx-auto mt-8 md:mt-10">
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

      {/* 開催中 rail (v5 #1)。開催が 0 件のときはセクションごと出さない。 */}
      {ongoing.length > 0 && (
        <section className="mt-section-sp md:mt-section-pc">
          <div className="w-main mx-auto">
            <SectionHeader
              eyebrow="No. 002 / Now"
              title="開催中"
              subtitle={`いま行けるイベント ${ongoing.length} 件`}
            />
          </div>
          {/*
            横スクロールの rail。`w-main` の外へ出して**画面端まで**スクロールさせ、
            左右に `w-main` と同じ余白を作る (器の中で切ると窮屈になるため)。
            `snap-x` でカード単位に止まる。
          */}
          <ul className="rail w-main mx-auto">
            {ongoing.map((occurrence) => (
              <li key={occurrence.id} className="snap-start">
                <OngoingOccurrenceCard occurrence={occurrence} />
              </li>
            ))}
          </ul>
        </section>
      )}

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
          <ul className="rail w-main mx-auto">
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
