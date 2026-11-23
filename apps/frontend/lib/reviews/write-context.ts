import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import type { ReviewRouteParams } from '@/actions/review';
import { getCurrentMember, memberRedirect } from '@/lib/auth/member';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { todayInJst } from '@/lib/occurrence/status';
import type { OwnReview } from '@/lib/reviews/authoring';
import { authoringMode } from '@revolution/reviews/eligibility';
import { notifyAboutReview, type ReviewNotifier } from '@revolution/reviews/notifications';
import { screenSubmittedReview } from '@revolution/reviews/operations';
import { syncPhotoDeliverySafely } from '@revolution/reviews/photos/delivery';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { getReviewScreener } from '@revolution/reviews/screener';
import { getReviewNotifier } from '@/lib/reviews/notifier';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * 口コミを書く Server Action (本文 `actions/review.ts`・写真 `actions/review-photos.ts`) が共通で使う下ごしらえ。
 * `'use server'` のファイルから export すると、クライアントから呼べる action になってしまうので、ここに置く。
 */

export type WriteContextFailure = 'not_found' | 'needs_login' | 'needs_onboarding';

/** 開催と会員を引く。書けるかは `modeFor` で呼ぶ側が決める */
export async function resolveWriteContext(route: ReviewRouteParams) {
  const [detail, member] = await Promise.all([
    getOccurrenceDetail(route.eventId, route.occurrenceSlug),
    getCurrentMember(),
  ]);
  if (!detail || detail.event.primaryCategory.slug !== route.eventType) {
    return { ok: false as const, reason: 'not_found' as WriteContextFailure };
  }
  // 会員でなければ、入力の検証より先に返す (ログインの案内を優先する)
  if (!member.ok) {
    return {
      ok: false as const,
      reason: (memberRedirect(member.reason) === 'login'
        ? 'needs_login'
        : 'needs_onboarding') as WriteContextFailure,
    };
  }
  const admin = createAdminClient();
  if (!admin) throw new Error('review write skipped: SUPABASE_SECRET_KEY is not set');
  // 公開になった・公開でなくなった時に作り直すページ: 開催 (口コミの一覧・星) と企画 (開催ごとの星の集計)
  const paths = [getOccurrenceUrl(detail.event, detail.occurrence.slug), getEventUrl(detail.event)];
  return { ok: true as const, detail, profileId: member.profileId, admin, paths };
}

export function modeFor(
  occurrence: { status: OccurrenceStatus; startsOn: string | null; endsOn: string | null },
  own: OwnReview | null
) {
  return authoringMode({
    occurrenceStatus: occurrence.status,
    startsOn: occurrence.startsOn,
    endsOn: occurrence.endsOn,
    today: todayInJst(),
    own,
  });
}

/** 口コミの写真の配信側を、今の状態に合わせる (`after()` の中。失敗は Sentry へ) */
export async function syncReviewPhotoDelivery(db: SupabaseClient, reviewId: number): Promise<void> {
  const storage = getReviewPhotoStorage();
  if (storage) await syncPhotoDeliverySafely({ db, storage }, reviewId);
}

/**
 * 応答の後 (`after()`) に AI の審査を走らせる。公開になったらページを作り直す。
 * 会員の提出・出し直しと審査の結果を、Slack に 1 通で知らせる (公開・差し戻しはお知らせ、BOSS の確認待ちは
 * 要対応。#169)。審査の後に送るので、Slack が遅くても審査は待たない。審査が例外で止まった時は、提出・
 * 出し直しだけを知らせる (口コミは審査中のまま。30 分たつと管理アプリの「止まっている」に出る)
 */
export async function screenAfterSubmit(
  db: SupabaseClient,
  reviewId: number,
  paths: string[],
  options: { trigger: 'submitted' | 'edited'; notifier?: ReviewNotifier }
): Promise<void> {
  const notifier = options.notifier ?? getReviewNotifier();
  try {
    const outcome = await screenSubmittedReview(reviewId, {
      screener: await getReviewScreener(),
      db,
      storage: getReviewPhotoStorage(),
    });
    // 審査中でない・出し直された時は何も知らせない (出し直しの方が自分で知らせる)
    if (outcome.kind !== 'screened') return;
    if (outcome.status === 'published') {
      for (const path of paths) revalidatePath(path);
    }
    await notifyAboutReview({ notifier, db }, reviewId, review => ({
      type: 'review_screened',
      review,
      status: outcome.status,
      aiFailure: outcome.aiFailure,
      trigger: options.trigger,
    }));
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'screenAfterSubmit' } });
    await notifyAboutReview({ notifier, db }, reviewId, review => ({
      type: options.trigger === 'edited' ? 'review_edited' : 'review_submitted',
      review,
    }));
  }
}
