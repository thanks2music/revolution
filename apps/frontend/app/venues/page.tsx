/**
 * 会場一覧 `/venues` (S2)
 *
 * 会場ページ (`/venues/{slug}`) への入口。対象は `listVenueParams` (静的生成対象)
 * と同じ「venues マスタの全行」なので、リンク先は必ず生成済み (= 404 しない)。
 * 開催 0 件の会場も載せる (会場ページ側が空状態を通常状態として描く。
 * `/titles` と同じ方針で、`/events` の「開催を持つ企画のみ」とは基準が異なる —
 * 企画は開催が無いと中身が組めないが、会場はマスタ情報 (名前・住所) だけで
 * ページとして成立する)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/molecules/EmptyState';
import Layout from '@/components/templates/Layout';
import { generateContentMetadata } from '@/lib/metadata';
import { listVenueDetails } from '@/lib/venue/queries';
import { getVenueUrl } from '@/lib/venue/venue-url';

export const revalidate = 120;

export const metadata: Metadata = generateContentMetadata({
  title: '会場から探す',
  description: 'コラボカフェ・イベント会場の一覧。会場ごとに全企画の開催情報を集約しています。',
  path: '/venues',
});

export default async function VenuesPage() {
  const venues = await listVenueDetails();

  return (
    <Layout>
      <div className="mx-auto w-main py-section-sp md:py-section-pc">
        <nav aria-label="パンくず" className="mb-6 text-sm text-ink-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:underline">
                ホーム
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">会場から探す</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          会場から探す
        </h1>

        {venues.length > 0 ? (
          <>
            <p className="mb-6 text-sm text-ink-muted">
              <span className="font-numeric tabular-nums">{venues.length}</span> 件
            </p>

            <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3" data-grid-cols="3">
              {venues.map((venue) => {
                // 都道府県・市区は null を取り得る (データ源が無い項目は置かない)。
                const region = [venue.prefecture, venue.city].filter(Boolean).join(' ');
                return (
                  <li key={venue.id}>
                    <Link
                      href={getVenueUrl(venue.slug)}
                      className="flex items-center gap-2 rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
                    >
                      <div className="min-w-0">
                        <p className="font-display font-bold text-ink-strong">{venue.name}</p>
                        {/*
                          エリアと開催数は**どちらも無ければ行ごと出さない**
                          (「データ源が無い項目は置かない」の既存規律)。
                          開催 0 件の会場も一覧には載る (ページは生成される) が、
                          「開催 0 件」とは書かない。
                        */}
                        {(region || venue.occurrenceCount > 0) && (
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {region}
                            {region && venue.occurrenceCount > 0 && ' ・ '}
                            {venue.occurrenceCount > 0 && (
                              <>
                                開催
                                <span className="font-numeric tabular-nums">
                                  {venue.occurrenceCount}
                                </span>
                                件
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      <span aria-hidden="true" className="ml-auto text-ink-muted">
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState message="会場はまだ登録されていません。" />
        )}
      </div>
    </Layout>
  );
}
