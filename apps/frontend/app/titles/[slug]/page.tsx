/**
 * 作品ハブ `/titles/{slug}` (S2)
 *
 * ## 集約ビューであって正準の所有者ではない (URL 設計 §7)
 *
 * title はコラボ (M:N) のため、企画・開催・記事の正準を持てない。
 * このページは「概要 + 記事 + 開催 + 企画」を**集約**し、一覧の各 item は
 * 本拠地 (`/events/{id}` / `/events/{id}/{slug}` / `/articles/{ULID}`) へ送る。
 *
 * ## 記事の紐付け (2026-08-21 BOSS 確定、案 X)
 *
 * 記事 frontmatter の `title_slugs` は AI ゆれを含むため直接は使わず、
 * `event_data.event_slug` → `events.slug` → `event_titles` の**取り込み済み
 * 正準**を経由する。理由と限界は `lib/title/article-links.ts` の docstring。
 *
 * ## 出さないもの (v5 デザインの方針を踏襲)
 *
 * - 別名チップ: `title_aliases` は anon から 0 行 (RLS)。SSG では出せない
 * - 星評価・平均: `reviews` 0 件の間は件数のみ (0.0 も出さない)。S4 の範囲
 * - あらすじ / キービジュアル / 公式サイト: `titles` に列がない
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArticleGrid } from '@/components/organisms/ArticleGrid';
import { OccurrenceCard } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { getEventUrl } from '@/lib/event/event-url';
import { getAllArticles } from '@/lib/mdx/articles';
import { generateContentMetadata } from '@/lib/metadata';
import { selectTitleArticles } from '@/lib/title/article-links';
import { titleKindLabel } from '@/lib/title/contracts';
import { getTitleHubData, listTitleParams } from '@/lib/title/queries';
import {
  getTitleArticlesUrl,
  getTitleOccurrencesUrl,
  getTitleUrl,
} from '@/lib/title/title-url';
import type { PageProps } from '@/types/page-props';

// 企画・開催詳細ページと揃える (S3 の取り込み直後に反映されてほしい)。
export const revalidate = 120;

/** ハブに出す記事の上限。全件は `/titles/{slug}/articles` の役目。 */
const HUB_ARTICLE_LIMIT = 3;

type TitlePageProps = PageProps<{ slug: string }>;

export async function generateStaticParams() {
  return listTitleParams();
}

export async function generateMetadata(props: TitlePageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) {
    return { title: '作品情報が見つかりません' };
  }

  const eventCount = data.eventGroups.length;
  // titles に説明文の列は無いので、常に集約内容から組み立てる。
  const description =
    `${data.title.name} のコラボカフェ・イベント情報まとめ。` +
    (eventCount > 0 ? `開催中・過去の企画 ${eventCount} 件を集約しています。` : '');

  return generateContentMetadata({
    title: `${data.title.name} のイベント情報`,
    description,
    path: getTitleUrl(data.title.slug),
  });
}

export default async function TitlePage(props: TitlePageProps) {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) notFound();

  const { title, eventGroups, eventSlugs } = data;
  const articles = selectTitleArticles(getAllArticles(), eventSlugs, title.slug);
  const occurrenceCount = eventGroups.reduce((sum, group) => sum + group.occurrences.length, 0);
  const reviewCount = eventGroups.reduce((sum, group) => sum + group.event.ratingCount, 0);

  return (
    <Layout>
      <article className="mx-auto w-main py-section-sp md:py-section-pc">
        <nav aria-label="パンくず" className="mb-6 text-sm text-ink-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:underline">
                ホーム
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{title.name}</span>
            </li>
          </ol>
        </nav>

        <header className="mb-12">
          <span className="inline-flex items-center rounded-full bg-bg-tinted px-3 py-1 font-display text-xs tracking-wide text-primary-700">
            {titleKindLabel(title.kind)}
          </span>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
            {title.name}
          </h1>
          {/* name_kana は現状の seed では全件 null。null なら行ごと出さない。 */}
          {title.nameKana && <p className="mt-1 text-sm text-ink-muted">{title.nameKana}</p>}

          <dl className="mt-6 flex gap-8">
            {[
              ['企画', eventGroups.length],
              ['開催', occurrenceCount],
              ['レビュー', reviewCount],
            ].map(([label, count]) => (
              <div key={label}>
                <dt className="text-xs text-ink-muted">{label}</dt>
                {/* レビュー 0 件でも星・平均は出さず件数だけを出す (v5 の表示ルール)。 */}
                <dd className="font-numeric text-lg font-bold tabular-nums text-ink-strong">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <section className="mb-12">
          <h2 className="mb-1 font-display text-2xl font-bold text-ink-strong">この作品の企画</h2>
          <p className="mb-6 text-sm text-ink-muted">
            {eventGroups.length > 0 ? (
              <>
                <span className="font-numeric tabular-nums">{eventGroups.length}</span> 件 /{' '}
                <Link href={getTitleOccurrencesUrl(title.slug)} className="hover:underline">
                  開催一覧を見る (
                  <span className="font-numeric tabular-nums">{occurrenceCount}</span>)
                </Link>
              </>
            ) : (
              'この作品の開催情報はまだ登録されていません。'
            )}
          </p>

          <ul className="grid gap-4">
            {eventGroups.map(({ event, occurrences }) => (
              <li
                key={event.id}
                className="border border-[var(--line-soft)] bg-bg-elevated p-4 md:p-5"
              >
                <div className="mb-3 flex flex-wrap items-baseline gap-2">
                  <Link
                    href={getEventUrl(event.id)}
                    className="font-display text-lg font-bold text-ink-strong hover:text-primary-700"
                  >
                    {event.name}
                  </Link>
                  <span className="text-sm text-ink-muted">
                    全 <span className="font-numeric tabular-nums">{occurrences.length}</span> 会場
                  </span>
                </div>
                <ul className="grid gap-3">
                  {occurrences.map((occurrence) => (
                    <li key={occurrence.id}>
                      <OccurrenceCard eventId={event.id} occurrence={occurrence} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 font-display text-2xl font-bold text-ink-strong">記事</h2>
          <p className="mb-6 text-sm text-ink-muted">
            {articles.length > 0 ? (
              <>
                <span className="font-numeric tabular-nums">{articles.length}</span> 本 /{' '}
                <Link href={getTitleArticlesUrl(title.slug)} className="hover:underline">
                  すべて見る
                </Link>
              </>
            ) : (
              'この作品の記事はまだありません。'
            )}
          </p>
          {articles.length > 0 && (
            <ArticleGrid articles={articles.slice(0, HUB_ARTICLE_LIMIT)} layout="grid" />
          )}
        </section>
      </article>
    </Layout>
  );
}
