'use server';

/**
 * 口コミの Server Actions (S4 / one-more-time #161)。
 *
 * - submitReview: 口コミを提出する。挿入は RLS の効くクライアントで行い (投稿者は内容の列だけを書ける)、
 *   応答の後に `after()` で AI の審査を走らせる。審査の結果の書き込みは操作の層 (service role)
 *
 * 設計 (favorite.ts の方針を踏襲):
 * - 投稿者と開催はクライアントから受け取らない。投稿者は会員の profiles.id (`getCurrentMember`)、
 *   開催は URL の種別・企画 ID・開催の slug からサーバーで引く
 * - throw せず型付きの結果を返す。ユーザーの入力に起因する失敗 (形の誤り・二重の投稿・期間外の訪問日・
 *   未ログイン) は Sentry に送らない。DB の障害など想定外の例外だけを送る (llm-context/sentry-rules.md)
 */

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import {
  REVIEW_SCREENING_REASONS,
  ReviewSubmitSchema,
  type ReviewScreeningReason,
  type ReviewSubmitInput,
} from '@revolution/schemas/review';

import { getCurrentMember } from '@/lib/auth/member';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import { reviewBlockReason } from '@/lib/reviews/eligibility';
import { screenSubmittedReview } from '@/lib/reviews/operations';
import { getReviewScreener } from '@/lib/reviews/screener';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';
/** 開催と訪問日のトリガが投げる文言の一部 (migration 20261121070749 の RAISE) */
const TRIGGER_MESSAGES = {
  visitedOn: 'review visited_on is out of range',
  occurrence: 'review occurrence',
} as const;

export type ReviewRouteParams = { eventType: string; eventId: string; occurrenceSlug: string };

/** 入力の欄ごとの誤り (画面の欄の下に出す) */
export type ReviewFieldErrors = Partial<Record<keyof ReviewSubmitInput, string>>;

export type SubmitReviewFailure = {
  ok: false;
  error: string;
  fieldErrors?: ReviewFieldErrors;
  needsAuth?: boolean;
};

export type SubmitReviewResult = { ok: true; reviewId: number } | SubmitReviewFailure;

const FAILURES = {
  notFound: { ok: false, error: '開催が見つかりません' },
  needsLogin: { ok: false, error: 'ログインしてください', needsAuth: true },
  needsOnboarding: {
    ok: false,
    error: 'プロフィールの登録を済ませてから投稿してください',
    needsAuth: true,
  },
  duplicate: { ok: false, error: 'この開催には、もう口コミを書いています' },
  notReviewable: { ok: false, error: 'この開催には、まだ口コミを書けません' },
  visitedOnOutOfRange: {
    ok: false,
    error: '入力を確かめてください',
    fieldErrors: { visitedOn: '開催期間の中で、今日までの日付を選んでください' },
  },
  unexpected: { ok: false, error: '投稿できませんでした。時間をおいてもう一度お試しください' },
} as const satisfies Record<string, SubmitReviewFailure>;

export async function submitReview(
  route: ReviewRouteParams,
  input: Omit<ReviewSubmitInput, 'occurrenceId'>
): Promise<SubmitReviewResult> {
  try {
    return await submit(route, input);
  } catch (error) {
    // 開催の取得・認証・DB の障害など。画面の入力を失わせないよう、型付きの結果で返す
    Sentry.captureException(error, { tags: { action: 'submitReview' } });
    return FAILURES.unexpected;
  }
}

async function submit(
  route: ReviewRouteParams,
  input: Omit<ReviewSubmitInput, 'occurrenceId'>
): Promise<SubmitReviewResult> {
  const [detail, member] = await Promise.all([
    getOccurrenceDetail(route.eventId, route.occurrenceSlug),
    getCurrentMember(),
  ]);
  if (!detail || detail.event.primaryCategory.slug !== route.eventType) return FAILURES.notFound;
  // 会員でなければ、入力の検証より先に返す (ログインの案内を優先する)
  if (!member.ok) {
    return member.reason === 'not_onboarded' ? FAILURES.needsOnboarding : FAILURES.needsLogin;
  }
  if (reviewBlockReason(detail.occurrence.status)) return FAILURES.notReviewable;

  const parsed = ReviewSubmitSchema.safeParse({ ...input, occurrenceId: detail.occurrence.id });
  if (!parsed.success) {
    const fieldErrors: ReviewFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof ReviewSubmitInput | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ok: false, error: '入力を確かめてください', fieldErrors };
  }

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      occurrence_id: value.occurrenceId,
      user_id: member.profileId,
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
    if (error.code === PG_UNIQUE_VIOLATION) return FAILURES.duplicate;
    // DB のトリガ (private.check_review_occurrence) の拒否だけを利用者向けの文にする。文言は migration の
    // RAISE と結合テスト (reviews-db.test.ts) で固定している。ほかの CHECK の違反は想定外として投げる
    if (error.code === PG_CHECK_VIOLATION) {
      if (error.message.includes(TRIGGER_MESSAGES.visitedOn)) return FAILURES.visitedOnOutOfRange;
      if (error.message.includes(TRIGGER_MESSAGES.occurrence)) return FAILURES.notReviewable;
    }
    throw error;
  }

  const reviewId = data.id as number;
  // 公開になったら作り直すページ: 開催 (口コミの一覧・星) と企画 (開催ごとの星の集計)
  const paths = [getOccurrenceUrl(detail.event, detail.occurrence.slug), getEventUrl(detail.event)];
  after(() => screenAfterSubmit(reviewId, paths));

  return { ok: true, reviewId };
}

/**
 * 応答の後に審査を走らせる。失敗しても口コミは審査中のまま残り、管理画面の「30 分以上審査中」の
 * 一覧で BOSS が拾える (仕様 #156)
 */
async function screenAfterSubmit(reviewId: number, paths: string[]): Promise<void> {
  const db = createAdminClient();
  if (!db) {
    Sentry.captureMessage('review screening skipped: SUPABASE_SECRET_KEY is not set', {
      level: 'error',
    });
    return;
  }
  try {
    const outcome = await screenSubmittedReview(reviewId, {
      screener: await getReviewScreener(),
      db,
    });
    if (outcome.kind === 'screened' && outcome.status === 'published') {
      for (const path of paths) revalidatePath(path);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'screenAfterSubmit' } });
  }
}

/**
 * 本人の口コミの状態 (開催のページの島がマウント後に呼ぶ。ページの静的な描画を壊さないため)。
 *
 * 理由と訪問日は anon・authenticated に GRANT していない列なので、本人の行だけを service role で読み、
 * 本人に返す。会員でない・口コミが無い・読めない時は null (ページの表示を止めない)。
 * AI 審査の失敗 (ai_failure) と確認待ちは、本人には「審査中」として見せる。
 */
export type OwnReviewState = {
  status: 'screening' | 'published' | 'rejected' | 'hidden';
  /** 差し戻しの理由のコード (rejected の時だけ) */
  reasonCode: ReviewScreeningReason | null;
  /** 訪問日 (YYYY-MM-DD)。本人にだけ日付まで見せる */
  visitedOn: string;
  /** 運営 (BOSS) が書いた、投稿者に見せる補足 (差し戻し・非公開の時) */
  note: string | null;
};

export async function getOwnReviewState(occurrenceId: number): Promise<OwnReviewState | null> {
  try {
    if (!Number.isInteger(occurrenceId) || occurrenceId <= 0) return null;
    const member = await getCurrentMember();
    const db = createAdminClient();
    if (!member.ok || !db) return null;

    const { data, error } = await db
      .from('reviews')
      .select('status, reason_code, reason_note, visited_on')
      .eq('occurrence_id', occurrenceId)
      .eq('user_id', member.profileId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status === 'draft') return null;

    const status =
      data.status === 'pending' || data.status === 'needs_review'
        ? 'screening'
        : (data.status as 'published' | 'rejected' | 'hidden');
    const reasonCode =
      status === 'rejected' &&
      (REVIEW_SCREENING_REASONS as readonly string[]).includes(data.reason_code)
        ? (data.reason_code as ReviewScreeningReason)
        : null;
    const note =
      (status === 'rejected' || status === 'hidden') && data.reason_note
        ? (data.reason_note as string)
        : null;
    return { status, reasonCode, visitedOn: data.visited_on as string, note };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getOwnReviewState' } });
    return null;
  }
}
