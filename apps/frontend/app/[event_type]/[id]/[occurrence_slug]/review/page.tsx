/**
 * 口コミの投稿 `/{種別}/{企画 ID}/{開催の slug}/review` (Figma #7、one-more-time #161)
 *
 * - ログインと onboarding が要る (`lib/supabase/middleware.ts` の `isPathProtected`)
 * - 書けるのは開催中か終了の開催だけ。開催前・中止・日程未発表、もう口コミがある時は、書けない理由を出す
 * - 提出は Server Action (`actions/review.ts`)。審査は応答の後 (`after()`) に走る
 *
 * 開催のページ (`../page.tsx`) と違い、cookie を読むので動的に描く (会員ごとの画面のため)。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { VENUE_NAME_FALLBACK } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { getCachedUser } from '@/lib/auth/current-user';
import { getCategory } from '@/lib/category/queries';
import { env } from '@/lib/env';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { formatPeriod } from '@/lib/occurrence/format';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { todayInJst } from '@/lib/occurrence/status';
import { buildXShareUrl } from '@/lib/reviews/labels';
import { findProfileId } from '@/lib/reviews/profile';
import { createClient } from '@/lib/supabase/server';
import type { OccurrencePageProps } from '@/types/page-props';

import { ReviewForm } from './ReviewForm';

/**
 * 提出の Server Action は、応答の後に審査 (`after()`) を走らせる。審査は最悪で約 64 秒
 * (20 秒 × 3 回 + 待ち 1 秒・3 秒、`lib/reviews/screener`)。関数が途中で止まらないよう余裕を持たせる
 */
export const maxDuration = 90;

export const metadata: Metadata = {
  title: '口コミを書く',
  robots: { index: false, follow: false },
};

export default async function ReviewSubmitPage(props: OccurrencePageProps) {
  const { event_type, id, occurrence_slug } = await props.params;
  const data = await getOccurrenceDetail(id, occurrence_slug);

  if (!data) notFound();
  if (data.event.primaryCategory.slug !== event_type) {
    if (!(await getCategory(event_type))) notFound();
    permanentRedirect(`${getOccurrenceUrl(data.event, data.occurrence.slug)}/review`);
  }

  const { occurrence, event } = data;
  const occurrencePath = getOccurrenceUrl(event, occurrence.slug);
  const venueName = occurrence.venueName ?? VENUE_NAME_FALLBACK;
  const blocked = await blockedReason(occurrence);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-md px-4 py-section-sp md:py-section-pc">
        <h1 className="mb-4 text-center font-display text-lg font-bold text-ink-strong">
          口コミを書く
        </h1>
        {blocked ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="rounded-xl border border-(--line-soft) bg-white p-4 text-sm text-ink-body">
              {blocked}
            </p>
            <Link href={occurrencePath} className="text-sm text-primary-700 underline">
              開催ページに戻る
            </Link>
          </div>
        ) : (
          <ReviewForm
            route={{ eventType: event_type, eventId: id, occurrenceSlug: occurrence.slug }}
            eventName={event.name}
            venueName={venueName}
            period={formatPeriod(occurrence.startsOn, occurrence.endsOn)}
            minDate={occurrence.startsOn!}
            maxDate={minDate(occurrence.endsOn, todayInJst())}
            occurrencePath={occurrencePath}
            shareUrl={buildXShareUrl({
              eventName: event.name,
              venueName,
              siteName: env.NEXT_PUBLIC_SITE_NAME,
              pageUrl: new URL(occurrencePath, env.NEXT_PUBLIC_SITE_URL).toString(),
            })}
          />
        )}
      </div>
    </Layout>
  );
}

/** 書けない理由。書ける時は null */
async function blockedReason(occurrence: { id: number; status: string; startsOn: string | null }) {
  switch (occurrence.status) {
    case 'scheduled':
      return 'この開催はまだ始まっていません。開催が始まったら口コミを書けます。';
    case 'unscheduled':
      return 'この開催は日程がまだ発表されていないため、口コミを書けません。';
    case 'cancelled':
      return 'この開催は中止になったため、口コミを書けません。';
  }
  if (!occurrence.startsOn) return 'この開催には口コミを書けません。';

  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return 'ログインしてください。';
  const supabase = await createClient();
  const profileId = await findProfileId(supabase, user.id).catch(() => null);
  if (!profileId) return null;
  const { data: existing, error } = await supabase
    .from('reviews')
    .select('id')
    .eq('occurrence_id', occurrence.id)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();
  // 確かめられない時は書かせる側に倒す (二重の投稿は DB の部分 unique が止める)
  if (!error && existing) return 'この開催には、もう口コミを書いています。';
  return null;
}

function minDate(endsOn: string | null, today: string): string {
  return endsOn && endsOn < today ? endsOn : today;
}
