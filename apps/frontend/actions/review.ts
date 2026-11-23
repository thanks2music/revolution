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

import {
  ReviewDraftSchema,
  ReviewSubmitSchema,
  type ReviewDraftInput,
  type ReviewScreeningReason,
  type ReviewSubmitInput,
} from '@revolution/schemas/review';

import { getCurrentMember } from '@/lib/auth/member';
import {
  deleteOwnReview,
  findOwnReview,
  saveDraft,
  submitDraft,
  toContentColumns,
  type OwnReview,
  type ReviewContent,
} from '@/lib/reviews/authoring';
import { explainsReason, ownReviewStatus, type OwnReviewStatus } from '@/lib/reviews/eligibility';
import { toScreeningReason } from '@/lib/reviews/labels';
import {
  modeFor,
  resolveWriteContext,
  screenAfterSubmit,
  syncReviewPhotoDelivery,
  type WriteContextFailure,
} from '@/lib/reviews/write-context';
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
  draftConflict: {
    ok: false,
    error: 'ほかの端末で同じ開催の口コミを書き始めています。ページを読み込み直してください',
  },
  draftUnexpected: {
    ok: false,
    error: '下書きを保存できませんでした。時間をおいてもう一度お試しください',
  },
} as const satisfies Record<string, SubmitReviewFailure>;

const CONTEXT_FAILURES: Record<WriteContextFailure, SubmitReviewFailure> = {
  not_found: FAILURES.notFound,
  needs_login: FAILURES.needsLogin,
  needs_onboarding: FAILURES.needsOnboarding,
};

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

/** 開催と会員を引き、会員でない・開催が無い時は利用者向けの結果にする */
async function resolveContext(route: ReviewRouteParams) {
  const context = await resolveWriteContext(route);
  if (context.ok) return context;
  return { ok: false as const, failure: CONTEXT_FAILURES[context.reason] };
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
 * で固定している。ほかの拒否・例外はそのまま投げる (supabase の結果の error も、操作の層が投げた error も受ける)
 */
function toWriteFailure(error: unknown): SubmitReviewFailure {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === PG_UNIQUE_VIOLATION) return FAILURES.duplicate;
  if (code === PG_CHECK_VIOLATION && typeof message === 'string') {
    if (message.includes(TRIGGER_MESSAGES.visitedOn)) return FAILURES.visitedOnOutOfRange;
    if (message.includes(TRIGGER_MESSAGES.occurrence)) return FAILURES.notReviewable;
  }
  throw error;
}

/** 書き込みを走らせ、DB の想定内の拒否を利用者向けの結果にする */
async function guardWrite<T>(write: () => Promise<T>): Promise<T | SubmitReviewFailure> {
  try {
    return await write();
  } catch (error) {
    return toWriteFailure(error);
  }
}

function isFailure(value: unknown): value is SubmitReviewFailure {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

async function submit(
  route: ReviewRouteParams,
  input: Omit<ReviewSubmitInput, 'occurrenceId'>
): Promise<SubmitReviewResult> {
  const context = await resolveContext(route);
  if (!context.ok) return context.failure;
  const { detail, profileId, admin, paths } = context;

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
  const mode = modeFor(detail.occurrence, existing);
  if (mode.kind === 'blocked') return FAILURES.notReviewable;

  const result = await guardWrite(async (): Promise<number | SubmitReviewFailure> => {
    if (mode.kind === 'new') {
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
      if (error) throw error;
      return data.id as number;
    }
    const own = existing!;
    if (mode.kind === 'draft') {
      // 下書きの提出は状態を書くので、サーバーが行う (開催と訪問日は DB のトリガも確かめる)
      const submitted = await submitDraft(admin, { profileId, reviewId: own.id, content });
      return submitted ? own.id : FAILURES.alreadySubmitted;
    }
    // 提出した口コミの内容の変更は投稿者の RLS のクライアントで書く。内容が変わった時だけ、トリガが
    // 審査中に戻して提出の日時を進める (公開の後なら最終編集日も)。変わったかの判定はトリガに任せる
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('reviews')
      .update(toContentColumns(content))
      .eq('id', own.id)
      // RLS の更新の policy は「本人の行か」しか見ないので、論理削除した行を書き換えないよう明示する
      .is('deleted_at', null)
      .select('submitted_at');
    if (error) throw error;
    // 読んだ後に別の端末で削除された
    if (!data || data.length === 0) return FAILURES.notFound;
    // 内容が変わればトリガが submitted_at を進める (0018 の guard_review_author_write。結合テストで固定)。
    // 読んでから書くまでの間に別の端末が出し直した場合は、その結果に従う (どちらでも DB の状態は正しい)
    if (data[0].submitted_at === own.submittedAt) return FAILURES.noChanges;
    // 公開中だった口コミは審査中に戻って見えなくなるので、すぐにページを作り直す
    if (own.status === 'published') for (const path of paths) revalidatePath(path);
    return own.id;
  });
  if (isFailure(result)) return result;

  after(() => screenAfterSubmit(admin, result, paths));
  return { ok: true, reviewId: result };
}

export type SaveDraftResult = { ok: true } | SubmitReviewFailure;

/** 下書きを保存する (審査に回さない)。星と訪問日は空でよい */
export async function saveReviewDraft(
  route: ReviewRouteParams,
  input: Omit<ReviewDraftInput, 'occurrenceId'>
): Promise<SaveDraftResult> {
  try {
    return await saveDraftAction(route, input);
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'saveReviewDraft' } });
    return FAILURES.draftUnexpected;
  }
}

async function saveDraftAction(
  route: ReviewRouteParams,
  input: Omit<ReviewDraftInput, 'occurrenceId'>
): Promise<SaveDraftResult> {
  const context = await resolveContext(route);
  if (!context.ok) return context.failure;
  const { detail, profileId, admin } = context;
  // 下書きを書けるかは開催だけで決まる (提出した口コミがあれば、saveDraft が not_draft を返す)
  if (modeFor(detail.occurrence, null).kind === 'blocked') return FAILURES.notReviewable;

  const parsed = ReviewDraftSchema.safeParse({ ...input, occurrenceId: detail.occurrence.id });
  if (!parsed.success) {
    return {
      ok: false,
      error: '入力を確かめてください',
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }
  const outcome = await guardWrite(() =>
    saveDraft(admin, { profileId, occurrenceId: detail.occurrence.id, content: parsed.data })
  );
  // 同時に 2 つの端末で最初の下書きを作った (部分 unique)。もう片方を開き直してもらう
  if (isFailure(outcome)) return outcome === FAILURES.duplicate ? FAILURES.draftConflict : outcome;
  return outcome.kind === 'saved' ? { ok: true } : FAILURES.alreadySubmitted;
}

export type DeleteReviewResult = { ok: true } | SubmitReviewFailure;

/** 自分の口コミを削除する (論理削除)。削除の後は同じ開催にもう一度書ける */
export async function deleteReview(
  route: ReviewRouteParams,
  reviewId: number
): Promise<DeleteReviewResult> {
  try {
    if (!Number.isInteger(reviewId) || reviewId <= 0) return FAILURES.notFound;
    const context = await resolveContext(route);
    if (!context.ok) return context.failure;
    const { detail, profileId, admin, paths } = context;

    // 消すのはこの開催の口コミだけ (作り直すページと、消した口コミの開催を一致させる)
    const outcome = await deleteOwnReview(admin, {
      profileId,
      occurrenceId: detail.occurrence.id,
      reviewId,
    });
    if (outcome.kind === 'not_found') return FAILURES.notFound;
    // 公開中だった口コミは集計からも外れるので、ページを作り直す
    if (outcome.wasPublished) for (const path of paths) revalidatePath(path);
    // 配信側の写真は応答の後に消す。公開中からの編集で審査中になった口コミにも、写真が残っていることがある
    after(() => syncReviewPhotoDelivery(admin, reviewId));
    return { ok: true };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'deleteReview' } });
    return FAILURES.unexpected;
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
  /** 差し戻し・非公開の理由のコード (審査の 4 種だけ。ほかは null) */
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

    const own = await findOwnReview(db, member.profileId, occurrenceId);
    const status = own && ownReviewStatus(own.status);
    // 下書きは出さない。下書き以外は訪問日がある (DB の CHECK)
    if (!own || !status || !own.visitedOn) return null;
    const explained = explainsReason(own.status);
    return {
      status,
      // 差し戻しと非公開は、どちらも理由を見て直せる (仕様 #156)。マイページの出し方と揃える
      reasonCode: explained ? toScreeningReason(own.reasonCode) : null,
      visitedOn: own.visitedOn,
      note: explained ? own.reasonNote : null,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getOwnReviewState' } });
    return null;
  }
}
