/**
 * 会場ページ `/venues/{slug}` (S2)
 *
 * ## 集約ビューであって正準の所有者ではない (URL 設計 §7)
 *
 * このページは「その会場の全開催」を企画をまたいで**集約**し、一覧の各 item は
 * 本拠地 (`/events/{id}/{occurrence-slug}`) へ送る。
 *
 * ## 出さないもの (2026-08-21 BOSS 確定)
 *
 * - `geo`: SELECT で EWKB 16 進文字列が返るため MVP では読まない
 *   (`lib/venue/contracts.ts` の docstring。地図表示は住所文字列で足りる)
 * - 別名: `venue_aliases` は anon から 0 行 (RLS)。SSG では出せない
 * - 住所系 (prefecture / city / address) は null の項目を行ごと出さない
 *   (データ源が無い項目は置かない、v5 デザインの流儀)
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventOccurrenceCard } from '@/components/molecules/EventOccurrenceCard';
import Layout from '@/components/templates/Layout';
import { generateContentMetadata } from '@/lib/metadata';
import { getVenueDetail, listVenueParams } from '@/lib/venue/queries';
import { getVenueUrl } from '@/lib/venue/venue-url';
import type { PageProps } from '@/types/page-props';

// 企画・開催詳細ページと揃える (S3 の取り込み直後に反映されてほしい)。
export const revalidate = 120;

type VenuePageProps = PageProps<{ slug: string }>;

export async function generateStaticParams() {
  return listVenueParams();
}

export async function generateMetadata(props: VenuePageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getVenueDetail(slug);

  if (!data) {
    return { title: '会場情報が見つかりません' };
  }

  const occurrenceCount = data.groups.reduce((sum, group) => sum + group.items.length, 0);
  const region = [data.venue.prefecture, data.venue.city].filter(Boolean).join(' ');
  // venues に説明文の列は無いので、常に集約内容から組み立てる。
  const description =
    `${data.venue.name}${region ? ` (${region})` : ''} のコラボカフェ・イベント開催情報まとめ。` +
    (occurrenceCount > 0 ? `開催中・過去の開催 ${occurrenceCount} 件を集約しています。` : '');

  return generateContentMetadata({
    title: `${data.venue.name} の開催情報`,
    description,
    path: getVenueUrl(data.venue.slug),
  });
}

export default async function VenuePage(props: VenuePageProps) {
  const { slug } = await props.params;
  const data = await getVenueDetail(slug);

  if (!data) notFound();

  const { venue, groups } = data;
  const occurrenceCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const region = [venue.prefecture, venue.city].filter(Boolean).join(' ');

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
              <Link href="/venues" className="hover:underline">
                会場から探す
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{venue.name}</span>
            </li>
          </ol>
        </nav>

        <header className="mb-12">
          <h1 className="font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
            {venue.name}
          </h1>
          {/* 住所はデータ源がある項目だけを出す (全 null なら名前のみ)。 */}
          {(region || venue.address) && (
            <dl className="mt-4 grid gap-1 text-sm text-ink-body">
              {region && (
                <div className="flex gap-3">
                  <dt className="shrink-0 text-ink-muted">エリア</dt>
                  <dd>{region}</dd>
                </div>
              )}
              {venue.address && (
                <div className="flex gap-3">
                  <dt className="shrink-0 text-ink-muted">住所</dt>
                  <dd>{venue.address}</dd>
                </div>
              )}
            </dl>
          )}
        </header>

        <section>
          <h2 className="mb-1 font-display text-2xl font-bold text-ink-strong">
            この会場の開催
          </h2>
          <p className="mb-6 text-sm text-ink-muted">
            {occurrenceCount > 0 ? (
              <>
                <span className="font-numeric tabular-nums">{occurrenceCount}</span> 件
              </>
            ) : (
              'この会場の開催情報はまだ登録されていません。'
            )}
          </p>

          {groups.map((group) => (
            <section key={group.key} className="mb-8">
              <h3 className="mb-3 font-display text-base font-bold text-ink-strong">
                {group.label}
                <span className="ml-2 font-numeric text-xs font-normal tabular-nums text-ink-muted">
                  {group.items.length}
                </span>
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3" data-grid-cols="3">
                {group.items.map((occurrence) => (
                  <li key={occurrence.id}>
                    {/*
                      `venueName` は渡さない — このページ自身が会場なので、全行に
                      同じ名前が並んで無意味になる (作品の開催一覧では渡す)。
                    */}
                    <EventOccurrenceCard
                      eventId={occurrence.eventId}
                      slug={occurrence.slug}
                      eventName={occurrence.eventName}
                      status={occurrence.status}
                      startsOn={occurrence.startsOn}
                      endsOn={occurrence.endsOn}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      </article>
    </Layout>
  );
}
