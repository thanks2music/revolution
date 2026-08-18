/**
 * 企画ページ `/events/{id}` (S2)
 *
 * ## URL に slug を出さない理由
 *
 * `events.slug` は **upsert の自然キーであって URL 識別子ではない**。
 * 企画名は続報で表記が揺れるため slug も揺れる。URL に載せると、揺れるたびに
 * 正準 URL が変わる (2026-08-03 確定、`docs/schema/revolution-article-meta.md` §3)。
 *
 * ## S2 の時点で出さないブロック
 *
 * デザインは 6 ブロックを要求するが、**3 つはデータ源が存在しない**
 * (2026-08-14 実測)。評価サマリ = `reviews` 0 件 (S4) /
 * 全会場共通情報タブ = `event_attributes` テーブルが無い /
 * この企画の記事 = `article-index.json` が企画を特定できない (S3)。
 * 詳細は `lib/event/queries.ts` の docstring。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OccurrenceCard } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { groupOccurrencesByStatus } from '@/lib/event/grouping';
import { getEventDetail, listEventParams } from '@/lib/event/queries';
import { generateContentMetadata } from '@/lib/metadata';
import { formatPeriod } from '@/lib/occurrence/format';
import { toBadgeStatus } from '@/lib/occurrence/status';
import { isSafeHttpUrl } from '@/lib/url-safety';
import type { PageProps } from '@/types/page-props';

// 開催詳細ページと揃える (S3 の取り込み直後に反映されてほしい)。
export const revalidate = 120;

type EventPageProps = PageProps<{ id: string }>;

export async function generateStaticParams() {
  return listEventParams();
}

export async function generateMetadata(props: EventPageProps): Promise<Metadata> {
  const { id } = await props.params;
  const data = await getEventDetail(id);

  if (!data) {
    return { title: '企画情報が見つかりません' };
  }

  const venueCount = data.occurrences.length;
  // ⚠️ `??` では**空文字を素通しして `<meta description="">` になる**
  //    (本文側は `&&` でガードしているので挙動が食い違っていた)。
  //    `description` は DB で NOT NULL ではなく、空白のみを拒否する CHECK も無い。
  const fallback = `${data.event.name} の開催情報${venueCount > 0 ? ` (${venueCount} 会場)` : ''}`;
  // ⚠️ 判定だけでなく**出力にも trim 済みの値**を使う。判定に trim を使いながら
  //    元の値を出すと、前後に空白を含む説明文がそのまま meta に載る。
  const trimmed = data.event.description?.trim();
  const description = trimmed ? trimmed : fallback;

  return generateContentMetadata({
    title: data.event.name,
    description,
    path: getEventUrl(data.event.id),
  });
}

export default async function EventPage(props: EventPageProps) {
  const { id } = await props.params;
  const data = await getEventDetail(id);

  if (!data) notFound();

  const { event, titles, occurrences, relatedEvents } = data;
  const groups = groupOccurrencesByStatus(occurrences);

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
            {titles.map((title) => (
              <li key={title.slug} className="flex items-center gap-2">
                <span aria-hidden="true">/</span>
                {/* 作品ハブ `/titles/{slug}` は S2 の別タスク。未実装の間はリンクにしない。 */}
                <span>{title.name}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{event.name}</span>
            </li>
          </ol>
        </nav>

        <h1 className="mb-4 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          {event.name}
        </h1>

        {event.description && <p className="mb-6 text-ink-body">{event.description}</p>}

        {/* スキーム検証の理由は `lib/url-safety.ts` を参照。 */}
        {isSafeHttpUrl(event.officialUrl) && (
          <p className="mb-10">
            <a
              href={event.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-700 underline"
            >
              公式サイト
            </a>
          </p>
        )}

        <section className="mb-12">
          <h2 className="mb-1 font-display text-2xl font-bold text-ink-strong">会場を選ぶ</h2>
          <p className="mb-6 text-sm text-ink-muted">
            {occurrences.length > 0
              ? `${occurrences.length} 会場`
              : 'この企画の開催情報はまだ登録されていません。'}
          </p>

          {groups.map((group) => (
            <div key={group.key} className="mb-8">
              <h3 className="mb-3 font-display text-sm font-bold tracking-wide text-ink-muted">
                {group.label}
                <span className="ml-2 font-numeric tabular-nums">{group.items.length}</span>
              </h3>
              <ul className="grid gap-3">
                {group.items.map((occurrence) => (
                  <li key={occurrence.id}>
                    <OccurrenceCard eventId={event.id} occurrence={occurrence} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {relatedEvents.length > 0 && (
          <section>
            <h2 className="mb-4 font-display text-xl font-bold text-ink-strong">
              同じ作品の他の企画
            </h2>
            <ul className="grid gap-3">
              {relatedEvents.map((related) => (
                <li key={related.id}>
                  <Link
                    href={getEventUrl(related.id)}
                    className="block border border-[var(--line-soft)] bg-bg-elevated p-4 font-display text-ink-strong hover:border-[var(--line-strong)]"
                  >
                    {related.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </Layout>
  );
}
