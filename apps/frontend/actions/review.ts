'use server';

/**
 * 口コミの Server Actions (S4 / one-more-time #161)。
 *
 * - submitReview: 口コミを提出する。この開催の口コミが無ければ RLS の効くクライアントで入れ、下書きなら
 *   サーバー (service role、`lib/reviews/authoring.ts`) が提出にし、提出した口コミなら RLS のクライアントで
 *   内容を変える (トリガが審査中に戻す。#162)。応答の後に `after()` で AI の審査を走らせる
 * - saveReviewDraft / deleteReview: 下書きの保存と論理削除 (#162)。状態と deleted_at を書くので service role
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
import { z } from 'zod';

import {
  REVIEW_SCREENING_REASONS,
  REVIEW_STATUSES,
  ReviewDraftSchema,
  ReviewSubmitSchema,
  type ReviewDraftInput,
  type ReviewScreeningReason,
  type ReviewSubmitInput,
} from '@revolution/schemas/review';

import { getCurrentMember } from '@/lib/auth/member';
import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';
import { getOccurrenceDetail } from '@/lib/occurrence/queries';
import {
  deleteOwnReview,
  findOwnReview,
  saveDraft,
  submitDraft,
  toContentColumns,
  type ReviewContent,
} from '@/lib/reviews/authoring';
import {
  ownReviewStatus,
  reviewBlockReason,
  type OwnReviewStatus,
} from '@/lib/reviews/eligibility';
import { screenSubmittedReview } from '@/lib/reviews/operations';
import { getReviewScreener } from '@/lib/reviews/screener';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';
/**
 * 開催と訪問日のトリガが投げる文言の一部 (migration 20261121200109 の RAISE。20261121070749 で作り、
 * 20261121200109 で作り直した)
 */
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
  alreadySubmitted: {
    ok: false,
    error: 'この口コミはもう提出されています。ページを読み込み直して、編集してください',
  },
  notReviewable: { ok: false, error: 'この開催には、まだ口コミを書けません' },
  visitedOnOutOfRange: {
    ok: false,
    error: '入力を確かめてください',
    fieldErrors: { visitedOn: '開催期間の中で、今日までの日付を選んでください' },
  },
  noChanges: {
    ok: false,
    error: '内容が前と同じです。直してから、出し直してください',
  },
  unexpected: { ok: false, error: '投稿できませんでした。時間をおいてもう一度お試しください' },
  draftUnexpected: {
    ok: false,
    error: '下書きを保存できませんでした。時間をおいてもう一度お試しください',
  },
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

/** 開催と会員を引き、書けるかを確かめる (提出と下書きの保存で共通) */
async function resolveWriteContext(route: ReviewRouteParams) {
  const [detail, member] = await Promise.all([
    getOccurrenceDetail(route.eventId, route.occurrenceSlug),
    getCurrentMember(),
  ]);
  if (!detail || detail.event.primaryCategory.slug !== route.eventType) {
    return { ok: false as const, failure: FAILURES.notFound };
  }
  // 会員でなければ、入力の検証より先に返す (ログインの案内を優先する)
  if (!member.ok) return { ok: false as const, failure: memberFailure(member.reason) };
  const admin = createAdminClient();
  if (!admin) throw new Error('review write skipped: SUPABASE_SECRET_KEY is not set');
  // 公開になった・公開でなくなった時に作り直すページ: 開催 (口コミの一覧・星) と企画 (開催ごとの星の集計)
  const paths = [getOccurrenceUrl(detail.event, detail.occurrence.slug), getEventUrl(detail.event)];
  // 中止・開催前・日程未発表。新しく書く・下書きは止めるが、提出した口コミは直せる (仕様: いつでも編集)。
  // 止めるかは呼ぶ側が決める (訪問日を変える編集は、DB のトリガが止める)
  const blocked = reviewBlockReason(detail.occurrence.status) !== null;
  return { ok: true as const, detail, profileId: member.profileId, admin, paths, blocked };
}

function memberFailure(
  reason: Extract<Awaited<ReturnType<typeof getCurrentMember>>, { ok: false }>['reason']
): SubmitReviewFailure {
  return reason === 'not_onboarded' ? FAILURES.needsOnboarding : FAILURES.needsLogin;
}

/** 提出した口コミの内容が、前と変わっていないか (変わらなければトリガは状態を戻さず、審査にも回らない) */
function isSameContent(existing: ReviewContent, next: ReviewContent): boolean {
  const a = toContentColumns(existing);
  const b = toContentColumns(next);
  return (Object.keys(a) as (keyof typeof a)[]).every(key => a[key] === b[key]);
}

function toFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const fieldErrors: ReviewFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0] as keyof ReviewSubmitInput | undefined;
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return fieldErrors;
}

/**
 * DB の書き込みの拒否を、利用者向けの結果にする。二重の投稿と、開催と訪問日のトリガ
 * (private.check_review_occurrence) の拒否だけ。文言は migration の RAISE と結合テスト (reviews-db.test.ts)
 * で固定している。ほかの拒否は想定外として投げる
 */
function toWriteFailure(error: { code?: string; message: string }): SubmitReviewFailure {
  if (error.code === PG_UNIQUE_VIOLATION) return FAILURES.duplicate;
  if (error.code === PG_CHECK_VIOLATION) {
    if (error.message.includes(TRIGGER_MESSAGES.visitedOn)) return FAILURES.visitedOnOutOfRange;
    if (error.message.includes(TRIGGER_MESSAGES.occurrence)) return FAILURES.notReviewable;
  }
  throw error;
}

async function submit(
  route: ReviewRouteParams,
  input: Omit<ReviewSubmitInput, 'occurrenceId'>
): Promise<SubmitReviewResult> {
  const context = await resolveWriteContext(route);
  if (!context.ok) return context.failure;
  const { detail, profileId, admin, paths, blocked } = context;

  const parsed = ReviewSubmitSchema.safeParse({ ...input, occurrenceId: detail.occurrence.id });
  if (!parsed.success) {
    return {
      ok: false,
      error: '入力を確かめてください',
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }
  const content: ReviewContent = parsed.data;

  // この開催の口コミが既にあれば、下書きは提出、それ以外は内容の変更 (仕様: 1 開催 1 件、既にあれば編集)
  const existing = await findOwnReview(admin, profileId, detail.occurrence.id);
  if (blocked && (!existing || existing.status === 'draft')) return FAILURES.notReviewable;
  if (existing && existing.status !== 'draft' && isSameContent(existing, content)) {
    return FAILURES.noChanges;
  }
  let reviewId: number;
  try {
    if (!existing) {
      // 新しい口コミは投稿者の RLS のクライアントで入れる (トリガが審査中にする)
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('reviews')
        .insert({
          occurrence_id: detail.occurrence.id,
          user_id: profileId,
          ...toContentColumns(content),
        })
        .select('id')
        .single();
      if (error) return toWriteFailure(error);
      reviewId = data.id as number;
    } else if (existing.status === 'draft') {
      // 下書きの提出は状態を書くので、サーバーが行う (開催と訪問日は DB のトリガも確かめる)
      if (!(await submitDraft(admin, { profileId, reviewId: existing.id, content }))) {
        return FAILURES.alreadySubmitted;
      }
      reviewId = existing.id;
    } else {
      // 提出した口コミの内容の変更は投稿者の RLS のクライアントで書く。トリガが審査中に戻し、
      // 公開の後なら最終編集日を入れる
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('reviews')
        .update(toContentColumns(content))
        .eq('id', existing.id)
        .select('id');
      if (error) return toWriteFailure(error);
      // 読んだ後に別の端末で削除された
      if (!data || data.length === 0) return FAILURES.notFound;
      reviewId = existing.id;
      // 公開中だった口コミは審査中に戻って見えなくなるので、すぐにページを作り直す
      if (existing.status === 'published') for (const path of paths) revalidatePath(path);
    }
  } catch (error) {
    // submitDraft はトリガの拒否を投げる
    if (error && typeof error === 'object' && 'message' in error) {
      return toWriteFailure(error as { code?: string; message: string });
    }
    throw error;
  }

  after(() => screenAfterSubmit(reviewId, paths));
  return { ok: true, reviewId };
}

export type SaveDraftResult = { ok: true; reviewId: number } | SubmitReviewFailure;

/** 下書きを保存する (審査に回さない)。星と訪問日は空でよい */
export async function saveReviewDraft(
  route: ReviewRouteParams,
  input: Omit<ReviewDraftInput, 'occurrenceId'>
): Promise<SaveDraftResult> {
  try {
    const context = await resolveWriteContext(route);
    if (!context.ok) return context.failure;
    const { detail, profileId, admin, blocked } = context;
    if (blocked) return FAILURES.notReviewable;

    const parsed = ReviewDraftSchema.safeParse({ ...input, occurrenceId: detail.occurrence.id });
    if (!parsed.success) {
      return {
        ok: false,
        error: '入力を確かめてください',
        fieldErrors: toFieldErrors(parsed.error.issues),
      };
    }
    try {
      const outcome = await saveDraft(admin, {
        profileId,
        occurrenceId: detail.occurrence.id,
        content: parsed.data,
      });
      return outcome.kind === 'saved'
        ? { ok: true, reviewId: outcome.reviewId }
        : FAILURES.alreadySubmitted;
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error) {
        const failure = toWriteFailure(error as { code?: string; message: string });
        // 同時に 2 つの端末で下書きを作った (部分 unique)。もう片方の下書きを開き直してもらう
        return failure === FAILURES.duplicate ? FAILURES.alreadySubmitted : failure;
      }
      throw error;
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'saveReviewDraft' } });
    return FAILURES.draftUnexpected;
  }
}

export type DeleteReviewResult = { ok: true } | SubmitReviewFailure;

/** 自分の口コミを削除する (論理削除)。削除の後は同じ開催にもう一度書ける */
export async function deleteReview(
  route: ReviewRouteParams,
  reviewId: number
): Promise<DeleteReviewResult> {
  try {
    if (!Number.isInteger(reviewId) || reviewId <= 0) return FAILURES.notFound;
    const [detail, member] = await Promise.all([
      getOccurrenceDetail(route.eventId, route.occurrenceSlug),
      getCurrentMember(),
    ]);
    if (!member.ok) return memberFailure(member.reason);
    if (!detail || detail.event.primaryCategory.slug !== route.eventType) return FAILURES.notFound;
    const admin = createAdminClient();
    if (!admin) throw new Error('review delete skipped: SUPABASE_SECRET_KEY is not set');

    // 消すのはこの開催の口コミだけ (作り直すページと、消した口コミの開催を一致させる)
    const outcome = await deleteOwnReview(admin, {
      profileId: member.profileId,
      occurrenceId: detail.occurrence.id,
      reviewId,
    });
    if (outcome.kind === 'not_found') return FAILURES.notFound;
    // 公開中だった口コミは集計からも外れるので、ページを作り直す
    if (outcome.wasPublished) {
      revalidatePath(getOccurrenceUrl(detail.event, detail.occurrence.slug));
      revalidatePath(getEventUrl(detail.event));
    }
    return { ok: true };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'deleteReview' } });
    return FAILURES.unexpected;
  }
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
  status: OwnReviewStatus;
  /** 差し戻しの理由のコード (rejected の時だけ) */
  reasonCode: ReviewScreeningReason | null;
  /** 訪問日 (YYYY-MM-DD)。本人にだけ日付まで見せる */
  visitedOn: string;
  /** 運営 (BOSS) が書いた、投稿者に見せる補足 (差し戻し・非公開の時) */
  note: string | null;
};

const OwnReviewRowSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  // 審査の 4 種以外 (ai_failure・通報の理由) は本人には出さない
  reason_code: z.enum(REVIEW_SCREENING_REASONS).nullable().catch(null),
  reason_note: z.string().nullable(),
  visited_on: z.string(),
});

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
    if (!data) return null;

    const row = OwnReviewRowSchema.parse(data);
    const status = ownReviewStatus(row.status);
    if (!status) return null;
    const explained = status === 'rejected' || status === 'hidden';
    return {
      status,
      reasonCode: status === 'rejected' ? row.reason_code : null,
      visitedOn: row.visited_on,
      note: explained ? row.reason_note : null,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getOwnReviewState' } });
    return null;
  }
}
