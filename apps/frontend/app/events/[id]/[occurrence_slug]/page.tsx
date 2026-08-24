/**
 * 開催詳細ページ `/events/{id}/{occurrence-slug}` (S2)
 *
 * ## 位置づけ
 *
 * **frontend が `occurrences` を参照する最初のコード**。2026-08-14 時点で
 * `events` / `occurrences` / `venues` / `titles` を読む frontend コードは
 * 1 行も無く、`0013` で作ったテーブルが 8 日間使われていなかった。
 *
 * 開催はレビューの紐付け先 (S4) でもあるため、S2 の中で最初に作る
 * (`docs/event-review-data-model.md` §7)。
 *
 * ## ルートの衝突は本 PR 内で解消済み
 *
 * 設計当初は記事の 3 セグメントルート (`app/[event_type]/[work_slug]/[slug]`) と
 * URL 形が衝突していた (Next.js は静的セグメントを動的セグメントより優先するため
 * `/events/...` は本ルートが受ける、という前提で成立させていた)。
 * **その記事ルートは URL 移行で削除済み**なので、現在この衝突は存在しない。
 *
 * ## SSG を保つ制約
 *
 * データ取得は `lib/supabase/public.ts` の cookie を触らないクライアントを使う。
 * `lib/supabase/server.ts` は `cookies()` を読むため、使った瞬間に
 * dynamic rendering へ落ちて「SSG で成立する塊」という S2 の前提が崩れる。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RemainingDaysBadge } from '@/components/atoms/badge/RemainingDaysBadge';
import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import { OccurrenceCard, VENUE_NAME_FALLBACK } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { generateContentMetadata } from '@/lib/metadata';
import { getTitleUrl } from '@/lib/title/title-url';
import { formatPeriod } from '@/lib/occurrence/format';
import { getOccurrenceDetail, listOccurrenceParams } from '@/lib/occurrence/queries';
import { toBadgeStatus } from '@/lib/occurrence/status';
import { isSafeHttpUrl } from '@/lib/url-safety';
import type { OccurrencePageProps } from '@/types/page-props';

// 記事ページ (`/articles/[slug]`) と同じ 120 秒。開催情報は記事より更新頻度が
// 低いが、S3 の取り込みが走った直後に反映されてほしいので長くしない。
export const revalidate = 120;

export async function generateStaticParams() {
  return listOccurrenceParams();
}

export async function generateMetadata(props: OccurrencePageProps): Promise<Metadata> {
  const { id, occurrence_slug } = await props.params;
  const data = await getOccurrenceDetail(id, occurrence_slug);

  if (!data) {
    return { title: '開催情報が見つかりません' };
  }

  const venueName = data.occurrence.venueName ?? VENUE_NAME_FALLBACK;
  const period = formatPeriod(data.occurrence.startsOn, data.occurrence.endsOn);

  return generateContentMetadata({
    title: `${data.event.name} ${venueName}`,
    description: `${data.event.name} の ${venueName} 開催情報 (${period})`,
    path: getOccurrenceUrl(data.event.id, data.occurrence.slug),
  });
}

export default async function OccurrenceDetailPage(props: OccurrencePageProps) {
  const { id, occurrence_slug } = await props.params;
  const data = await getOccurrenceDetail(id, occurrence_slug);

  if (!data) notFound();

  const { occurrence, event, titles, siblings } = data;
  const venue = occurrence.venues;
  const venueName = occurrence.venueName ?? VENUE_NAME_FALLBACK;
  const badgeStatus = toBadgeStatus(occurrence.status);

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
                <Link href={getTitleUrl(title.slug)} className="hover:underline">
                  {title.name}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <Link href={getEventUrl(event.id)} className="hover:underline">
                {event.name}
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{venueName}</span>
            </li>
          </ol>
        </nav>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusBadge status={badgeStatus} />
          {/*
            残日数は **開催中のときだけ**出す。

            残日数バッジの「あと N 日」は `ends_on` までの日数 = 「行ける残り時間」。
            開催前 (`scheduled`) に出すと、読み手は「開始まであと N 日」と読むため
            **意味が反転して伝わる** (実測: 開始まで 14 日の開催に「あと 45 日」と
            表示されていた)。開催前の煽りは状態バッジ側の "Coming Soon" が担う。
            終了・中止・日程未発表は残り時間の概念そのものが無い。
          */}
          {occurrence.status === 'ongoing' && <RemainingDaysBadge endsOn={occurrence.endsOn} />}
        </div>

        <h1 className="mb-2 font-display text-3xl font-bold leading-tight text-ink-strong md:text-4xl">
          {event.name}
        </h1>
        <p className="mb-8 font-display text-xl text-ink-body">{venueName}</p>

        <dl className="mb-10 grid gap-4 border-t border-[var(--line-soft)] pt-6 md:grid-cols-[8rem_1fr]">
          <dt className="font-display text-sm text-ink-muted">期間</dt>
          <dd className="font-numeric tabular-nums text-ink-body">
            {formatPeriod(occurrence.startsOn, occurrence.endsOn)}
          </dd>

          <dt className="font-display text-sm text-ink-muted">会場</dt>
          <dd className="text-ink-body">
            {venueName}
            {venue?.prefecture && (
              <span className="ml-2 text-sm text-ink-muted">
                {venue.prefecture}
                {venue.city}
              </span>
            )}
            {venue?.address && (
              <span className="mt-1 block text-sm text-ink-muted">{venue.address}</span>
            )}
          </dd>

          {/*
            `official_url` はスクレイピング元 HTML から LLM が抽出した値で、
            zod (`z.string().url()`) も DB CHECK も **スキームを制限していない**
            (2026-08-14 実測: `javascript:` / `data:` が両方を通過する)。
            描画側で http(s) に限定する (`lib/url-safety.ts` に理由を記載)。
          */}
          {isSafeHttpUrl(event.officialUrl) && (
            <>
              <dt className="font-display text-sm text-ink-muted">公式</dt>
              <dd>
                <a
                  href={event.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-700 underline"
                >
                  公式サイト
                </a>
              </dd>
            </>
          )}
        </dl>

        {event.description && <p className="mb-10 text-ink-body">{event.description}</p>}

        {siblings.length > 0 && (
          <section>
            <h2 className="mb-4 font-display text-xl font-bold text-ink-strong">
              この企画の他の開催
            </h2>
            {/* 横 1 行型のカードなので 2 列止まり (理由は `OccurrenceCard` の docstring)。 */}
            <ul className="grid gap-3 md:grid-cols-2" data-grid-cols="2">
              {siblings.map((sibling) => (
                <li key={sibling.id}>
                  <OccurrenceCard eventId={event.id} occurrence={sibling} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </Layout>
  );
}
