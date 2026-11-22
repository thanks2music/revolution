/**
 * 口コミの投稿 `/{種別}/{企画 ID}/{開催の slug}/review` (Figma #7、one-more-time #161)
 *
 * - ログインと onboarding が要る (`lib/supabase/middleware.ts` の `isPathProtected`)
 * - 書けるのは開催中か終了の開催だけ。開催前・中止・日程未発表は、書けない理由を出す
 * - もう口コミがある開催では、その口コミの編集になる (下書きの続き・出し直し・公開後の編集、#162)
 * - 提出は Server Action (`actions/review.ts`)。審査は応答の後 (`after()`) に走る
 * - 写真は `actions/review-photos.ts` (one-more-time #163)。写真の変換 (sharp・libheif) もこのページの関数で動く
 *
 * 開催のページ (`../page.tsx`) と違い、cookie を読むので動的に描く (会員ごとの画面のため)。
 */

import * as Sentry from '@sentry/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { VENUE_NAME_FALLBACK } from '@/components/molecules/OccurrenceCard';
import Layout from '@/components/templates/Layout';
import { getCurrentMember } from '@/lib/auth/member';
import { getCategory } from '@/lib/category/queries';
import { env } from '@/lib/env';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { formatPeriod } from '@/lib/occurrence/format';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { todayInJst } from '@/lib/occurrence/status';
import { authoringMode } from '@/lib/reviews/eligibility';
import { buildXShareUrl } from '@/lib/reviews/share';
import { findOwnReview, type OwnReview } from '@/lib/reviews/authoring';
import { listOwnPhotos, type OwnReviewPhoto } from '@/lib/reviews/photos/operations';
import { getReviewPhotoStorage, type ReviewPhotoStorage } from '@/lib/reviews/photos/storage';
import { createAdminClient } from '@/lib/supabase/admin';
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
  // 会員の判定 (cookie と profiles) は開催と関係なく引けるので、並べて走らせる
  const [data, member] = await Promise.all([
    getOccurrenceDetail(id, occurrence_slug),
    // 確かめられない時は書かせる側に倒す (提出の時にもう一度確かめる)。障害は Sentry に送る
    getCurrentMember().catch((error: unknown) => {
      Sentry.captureException(error, { tags: { page: 'review-submit' } });
      return null;
    }),
  ]);

  if (!data) notFound();
  if (data.event.primaryCategory.slug !== event_type) {
    if (!(await getCategory(event_type))) notFound();
    permanentRedirect(`${getOccurrenceUrl(data.event, data.occurrence.slug)}/review`);
  }

  const { occurrence, event } = data;
  const occurrencePath = getOccurrenceUrl(event, occurrence.slug);
  const venueName = occurrence.venueName ?? VENUE_NAME_FALLBACK;
  // 同じ開催にもう書いていれば、その口コミの編集にする (仕様: 1 開催 1 件、既にあれば編集へ案内する)
  const own = member?.ok ? await loadOwnReview(occurrence.id, member.profileId) : null;
  // 写真の置き場所が無い環境 (R2 の env が無い) では、写真の欄を出さない
  const photoStorage = getReviewPhotoStorage();
  const photos =
    own && member?.ok && photoStorage
      ? await loadOwnPhotos(own.id, member.profileId, photoStorage)
      : [];
  const mode = authoringMode({
    occurrenceStatus: occurrence.status,
    startsOn: occurrence.startsOn,
    endsOn: occurrence.endsOn,
    today: todayInJst(),
    own,
  });

  return (
    <Layout>
      <div className="mx-auto w-full max-w-md px-4 py-section-sp md:py-section-pc">
        <h1 className="mb-4 text-center font-display text-lg font-bold text-ink-strong">
          口コミを書く
        </h1>
        {mode.kind === 'blocked' ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="rounded-xl border border-(--line-soft) bg-white p-4 text-sm text-ink-body">
              {mode.reason}
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
            minDate={mode.range.min}
            maxDate={mode.range.max}
            occurrencePath={occurrencePath}
            initial={own ?? undefined}
            photosEnabled={photoStorage !== null}
            initialPhotos={photos}
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

/** 会員の口コミに付けた写真 (本人だけが見る、短時間だけ有効な URL) */
async function loadOwnPhotos(
  reviewId: number,
  profileId: string,
  storage: ReviewPhotoStorage
): Promise<OwnReviewPhoto[]> {
  const db = createAdminClient();
  if (!db) return [];
  try {
    return await listOwnPhotos({ db, storage }, { profileId, reviewId });
  } catch (error) {
    // 写真が読めなくても、口コミは書けるようにする
    Sentry.captureException(error, { tags: { page: 'review-submit', part: 'photos' } });
    return [];
  }
}

/**
 * 会員のこの開催の口コミ (編集の初期値)。本人の訪問日は他人に見せない列なので、サーバーが service role で読む。
 * 確かめられない時は新しい口コミとして開く (二重の投稿は DB の部分 unique が止め、提出の時に理由を返す)
 */
async function loadOwnReview(occurrenceId: number, profileId: string): Promise<OwnReview | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  try {
    return await findOwnReview(admin, profileId, occurrenceId);
  } catch (error) {
    Sentry.captureException(error, { tags: { page: 'review-submit' } });
    return null;
  }
}
