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

import { RemainingDaysBadge } from '@/components/atoms/badge/RemainingDaysBadge';
import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import Layout from '@/components/templates/Layout';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { generateContentMetadata } from '@/lib/metadata';
import { formatPeriod } from '@/lib/occurrence/format';
import { toBadgeStatus } from '@/lib/occurrence/status';
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
              <h3 className="mb-3 font-display text-sm font-bold tracking-wide text-ink-muted">
                {group.label}
                <span className="ml-2 font-numeric tabular-nums">{group.items.length}</span>
              </h3>
              <ul className="grid gap-3">
                {group.items.map((occurrence) => (
                  <li key={occurrence.id}>
                    {/*
                      `OccurrenceCard` は流用しない — あちらの主表示は会場名で、
                      会場ページでは全行が同じ名前になり無意味。ここでは企画名を
                      主表示にした同型のカードを描く (バッジ・期間表記は共有)。
                    */}
                    <Link
                      href={getOccurrenceUrl(occurrence.eventId, occurrence.slug)}
                      className="flex flex-wrap items-center gap-3 border border-[var(--line-soft)] bg-bg-elevated p-4 hover:border-[var(--line-strong)]"
                    >
                      <StatusBadge status={toBadgeStatus(occurrence.status)} />
                      {/* 残日数は開催中のときだけ (`OccurrenceCard` と同じ理由)。 */}
                      {occurrence.status === 'ongoing' && (
                        <RemainingDaysBadge endsOn={occurrence.endsOn} />
                      )}
                      <span className="font-display text-ink-strong">{occurrence.eventName}</span>
                      <span className="font-numeric tabular-nums text-sm text-ink-muted">
                        {formatPeriod(occurrence.startsOn, occurrence.endsOn)}
                      </span>
                    </Link>
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
