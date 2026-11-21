'use server';

/**
 * 口コミの Server Actions (S4 / one-more-time #161)。
 *
 * - submitReview: 口コミを提出する。挿入は RLS の効くクライアントで行い (投稿者は内容の列だけを書ける)、
 *   応答の後に `after()` で AI の審査を走らせる。審査の結果の書き込みは操作の層 (service role)
 *
 * 設計 (favorite.ts の方針を踏襲):
 * - 投稿者 (user_id) と開催 (occurrence_id) はクライアントから受け取らない。投稿者は getUser() から、
 *   開催は URL の種別・企画 ID・開催の slug からサーバーで引く
 * - throw せず型付きの結果を返す。ユーザーの入力に起因する失敗 (形の誤り・二重の投稿・期間外の訪問日・
 *   未ログイン) は Sentry に送らない。DB の障害だけを送る (llm-context/sentry-rules.md)
 */

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { ReviewSubmitSchema, type ReviewSubmitInput } from '@revolution/schemas/review';

import { getCachedUser } from '@/lib/auth/current-user';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { screenSubmittedReview } from '@/lib/reviews/operations';
import { getReviewScreener } from '@/lib/reviews/screener';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

/** 口コミを書ける開催の状態 (開催中か終了。仕様 #156) */
const REVIEWABLE_STATUSES = new Set(['ongoing', 'ended']);

export type ReviewRouteParams = { eventType: string; eventId: string; occurrenceSlug: string };

/** 入力の欄ごとの誤り (画面の欄の下に出す) */
export type ReviewFieldErrors = Partial<Record<keyof ReviewSubmitInput, string>>;

export type SubmitReviewResult =
  | { ok: true; reviewId: number }
  | { ok: false; error: string; fieldErrors?: ReviewFieldErrors; needsAuth?: boolean };

export async function submitReview(
  route: ReviewRouteParams,
  input: Omit<ReviewSubmitInput, 'occurrenceId'>,
): Promise<SubmitReviewResult> {
  const detail = await getOccurrenceDetail(route.eventId, route.occurrenceSlug);
  if (!detail || detail.event.primaryCategory.slug !== route.eventType) {
    return { ok: false, error: '開催が見つかりません' };
  }
  if (!REVIEWABLE_STATUSES.has(detail.occurrence.status)) {
    return { ok: false, error: 'この開催には、まだ口コミを書けません' };
  }

  const parsed = ReviewSubmitSchema.safeParse({ ...input, occurrenceId: detail.occurrence.id });
  if (!parsed.success) {
    const fieldErrors: ReviewFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof ReviewSubmitInput | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ok: false, error: '入力を確かめてください', fieldErrors };
  }

  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return { ok: false, error: 'ログインしてください', needsAuth: true };

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      occurrence_id: value.occurrenceId,
      user_id: user.id,
      rating: value.rating,
      visited_on: value.visitedOn,
      attendance: value.attendance,
      food_cost_band: value.foodCostBand,
      goods_cost_band: value.goodsCostBand,
      body: value.body,
      has_spoiler: value.hasSpoiler,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'この開催には、もう口コミを書いています' };
    }
    if (error.code === PG_CHECK_VIOLATION && error.message.includes('visited_on')) {
      return {
        ok: false,
        error: '入力を確かめてください',
        fieldErrors: { visitedOn: '開催期間の中で、今日までの日付を選んでください' },
      };
    }
    if (error.code === PG_CHECK_VIOLATION) {
      return { ok: false, error: 'この開催には、まだ口コミを書けません' };
    }
    Sentry.captureException(error, { tags: { action: 'submitReview' } });
    return { ok: false, error: '投稿できませんでした。時間をおいてもう一度お試しください' };
  }

  const reviewId = data.id as number;
  const occurrencePath = getOccurrenceUrl(detail.event, detail.occurrence.slug);
  after(() => screenAfterSubmit(reviewId, occurrencePath));

  return { ok: true, reviewId };
}

/**
 * 応答の後に審査を走らせる。失敗しても口コミは審査中のまま残り、管理画面の「30 分以上審査中」の
 * 一覧で BOSS が拾える (仕様 #156)
 */
async function screenAfterSubmit(reviewId: number, occurrencePath: string): Promise<void> {
  const db = createAdminClient();
  if (!db) {
    Sentry.captureMessage('review screening skipped: SUPABASE_SECRET_KEY is not set', { level: 'error' });
    return;
  }
  try {
    const outcome = await screenSubmittedReview(reviewId, { screener: await getReviewScreener(), db });
    if (outcome.kind === 'screened' && outcome.status === 'published') revalidatePath(occurrencePath);
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'screenAfterSubmit' } });
  }
}
