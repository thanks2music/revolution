/**
 * 企画一覧 `/events` (S2)
 *
 * 企画ページ (`/events/{id}`) への入口。対象は `listEventParams` (静的生成対象)
 * と同じ「公開済み開催を 1 件以上持つ企画」なので、リンク先は必ず生成済み
 * (= 404 しない)。開催を持たない企画は載せない (空ページへリンクしない、
 * `findRelatedEvents` と同じ基準)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/molecules/EmptyState';
import { EventSummaryCard } from '@/components/molecules/EventSummaryCard';
import Layout from '@/components/templates/Layout';
import { listEventListItems } from '@/lib/event/queries';
import { generateContentMetadata } from '@/lib/metadata';

export const revalidate = 120;

export const metadata: Metadata = generateContentMetadata({
  title: '企画から探す',
  description:
    'コラボカフェ・イベント企画の一覧。企画ごとに全会場の開催情報を集約しています。',
  path: '/events',
});

export default async function EventsPage() {
  const events = await listEventListItems();

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
              <span aria-current="page">企画から探す</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          企画から探す
        </h1>

        {events.length > 0 ? (
          <>
            <p className="mb-6 text-sm text-ink-muted">
              <span className="font-numeric tabular-nums">{events.length}</span> 件
            </p>

            <ul className="grid gap-2">
              {events.map((event) => (
                <li key={event.id}>
                  <EventSummaryCard event={event} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState message="企画はまだ登録されていません。" />
        )}
      </div>
    </Layout>
  );
}
