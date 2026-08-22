/**
 * 作品の開催一覧 `/titles/{slug}/occurrences` (集約ビュー、URL 設計 §7)
 *
 * レビュー可能な開催 (= anon に見える `verified = true` の開催) を作品単位で
 * 集約する。各 item の canonical は本拠地 `/events/{id}/{occurrence-slug}`。
 *
 * データは DB (`occurrence_view` + venues 埋め込み) 由来。記事 index の
 * `event_data.occurrences[].venue_slug` は実データ全件 null のため使わない。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OccurrenceCard } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { groupOccurrencesByStatus } from '@/lib/event/grouping';
import { generateContentMetadata } from '@/lib/metadata';
import { getTitleHubData, listTitleParams } from '@/lib/title/queries';
import { getTitleOccurrencesUrl, getTitleUrl } from '@/lib/title/title-url';
import type { PageProps } from '@/types/page-props';

export const revalidate = 120;

type TitleOccurrencesPageProps = PageProps<{ slug: string }>;

export async function generateStaticParams() {
  // 開催 0 件でも空状態を通常状態として描く (ハブと同じ集合を生成する)。
  return listTitleParams();
}

export async function generateMetadata(props: TitleOccurrencesPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) {
    return { title: '作品情報が見つかりません' };
  }

  const occurrenceCount = data.eventGroups.reduce(
    (sum, group) => sum + group.occurrences.length,
    0,
  );
  return generateContentMetadata({
    title: `${data.title.name} の開催一覧`,
    description:
      `${data.title.name} のイベント開催一覧です。` +
      (occurrenceCount > 0 ? `${occurrenceCount} 会場の開催情報を集約しています。` : ''),
    path: getTitleOccurrencesUrl(data.title.slug),
  });
}

export default async function TitleOccurrencesPage(props: TitleOccurrencesPageProps) {
  const { slug } = await props.params;
  const data = await getTitleHubData(slug);

  if (!data) notFound();

  const { title, eventGroups } = data;
  const occurrences = eventGroups.flatMap((group) => group.occurrences);
  // 開催カードに企画名を添えるための逆引き (別企画の開催が同じグループに並ぶため)。
  const eventNameById = new Map(eventGroups.map(({ event }) => [event.id, event.name]));
  const groups = groupOccurrencesByStatus(occurrences);

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
              <Link href={getTitleUrl(title.slug)} className="hover:underline">
                {title.name}
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">開催一覧</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          {title.name} の開催一覧
        </h1>
        <p className="mb-8 text-sm text-ink-muted">
          {occurrences.length > 0 ? (
            <>
              <span className="font-numeric tabular-nums">{occurrences.length}</span> 会場
            </>
          ) : (
            'この作品の開催情報はまだ登録されていません。'
          )}
        </p>

        {groups.map((group) => (
          <section key={group.key} className="mb-8">
            <h2 className="mb-3 font-display text-sm font-bold tracking-wide text-ink-muted">
              {group.label}
              <span className="ml-2 font-numeric tabular-nums">{group.items.length}</span>
            </h2>
            <ul className="grid gap-3">
              {group.items.map((occurrence) => (
                <li key={occurrence.id}>
                  <p className="mb-1 text-xs text-ink-muted">
                    {eventNameById.get(occurrence.eventId)}
                  </p>
                  <OccurrenceCard eventId={occurrence.eventId} occurrence={occurrence} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Layout>
  );
}
