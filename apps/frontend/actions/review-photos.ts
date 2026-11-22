'use server';

/**
 * 口コミの写真の Server Actions (one-more-time #163)。
 *
 * - requestReviewPhotoUpload: 受け取り場所へ上げる署名付き URL を出す
 * - attachReviewPhoto: 上げた写真を取り込む (変換して保管し、行を足す)。下書きでない口コミなら審査中に
 *   戻るので、応答の後に審査を走らせる
 * - removeReviewPhoto / reorderReviewPhotos: 外す・並べ替える
 *
 * 口コミは URL の開催と会員から引く (口コミの ID をクライアントから受け取らない)。会員のこの開催の口コミが
 * 無い時は、先に下書きを保存してもらう (フォームが自動で保存してから呼ぶ)。
 * throw せず型付きの結果を返し、想定外の失敗だけを Sentry に送る (llm-context/sentry-rules.md)。
 */

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import {
  MAX_REVIEW_PHOTOS,
  ReviewPhotoUploadRequestSchema,
} from '@revolution/schemas/review-photo';

import type { ReviewRouteParams } from '@/actions/review';
import { findOwnReview } from '@/lib/reviews/authoring';
import {
  ingestPhoto,
  removePhoto,
  reorderPhotos,
  requestPhotoUpload,
  type OwnReviewPhoto,
} from '@/lib/reviews/photos/operations';
import { getReviewPhotoStorage, reviewPhotoKeyPrefix } from '@/lib/reviews/photos/storage';
import { modeFor, resolveWriteContext, screenAfterSubmit } from '@/lib/reviews/write-context';

export type ReviewPhotoFailure = { ok: false; error: string; needsAuth?: boolean };

const FAILURES = {
  notFound: { ok: false, error: '開催が見つかりません' },
  needsLogin: { ok: false, error: 'ログインしてください', needsAuth: true },
  needsOnboarding: {
    ok: false,
    error: 'プロフィールの登録を済ませてから投稿してください',
    needsAuth: true,
  },
  noReview: { ok: false, error: '先に下書きを保存してから、写真を付けてください' },
  notWritable: { ok: false, error: 'この口コミには、今は写真を付けられません' },
  unavailable: { ok: false, error: '今は写真を付けられません。時間をおいてもう一度お試しください' },
  full: { ok: false, error: `写真は ${MAX_REVIEW_PHOTOS} 枚までです` },
  busy: {
    ok: false,
    error:
      '取り込めていない写真が多いため、今は写真を付けられません。明日以降にもう一度お試しください',
  },
  invalidFile: { ok: false, error: 'JPEG・PNG・HEIC の、10MB までの写真を選んでください' },
  missing: { ok: false, error: '写真を受け取れませんでした。もう一度選び直してください' },
  tooLarge: { ok: false, error: '10MB を超える写真は付けられません' },
  unsupported: { ok: false, error: 'JPEG・PNG・HEIC の写真を選んでください' },
  unreadable: { ok: false, error: '写真を読み取れませんでした。別の写真を選んでください' },
  mismatch: {
    ok: false,
    error: '写真の並びを保存できませんでした。ページを読み込み直してください',
  },
  unexpected: {
    ok: false,
    error: '写真を保存できませんでした。時間をおいてもう一度お試しください',
  },
} as const satisfies Record<string, ReviewPhotoFailure>;

/** 写真を付けられる口コミを引く (会員の、この開催の、書ける状態の口コミ) */
async function resolvePhotoContext(route: ReviewRouteParams) {
  const context = await resolveWriteContext(route);
  if (!context.ok) {
    const failure =
      context.reason === 'needs_login'
        ? FAILURES.needsLogin
        : context.reason === 'needs_onboarding'
          ? FAILURES.needsOnboarding
          : FAILURES.notFound;
    return { ok: false as const, failure };
  }
  const { detail, profileId, admin, paths } = context;
  const own = await findOwnReview(admin, profileId, detail.occurrence.id);
  if (!own) return { ok: false as const, failure: FAILURES.noReview };
  if (modeFor(detail.occurrence, own).kind === 'blocked') {
    return { ok: false as const, failure: FAILURES.notWritable };
  }
  const storage = getReviewPhotoStorage();
  if (!storage) return { ok: false as const, failure: FAILURES.unavailable };
  return {
    ok: true as const,
    profileId,
    reviewId: own.id,
    paths,
    ctx: { db: admin, storage, prefix: reviewPhotoKeyPrefix() },
  };
}

/** 想定外の例外を Sentry に送り、利用者向けの結果にする */
async function guard<T>(action: string, run: () => Promise<T>): Promise<T | ReviewPhotoFailure> {
  try {
    return await run();
  } catch (error) {
    Sentry.captureException(error, { tags: { action } });
    return FAILURES.unexpected;
  }
}

export type RequestReviewPhotoUploadResult =
  { ok: true; photoId: string; url: string; headers: Record<string, string> } | ReviewPhotoFailure;

export async function requestReviewPhotoUpload(
  route: ReviewRouteParams,
  file: { contentType: string; size: number }
): Promise<RequestReviewPhotoUploadResult> {
  return guard('requestReviewPhotoUpload', async () => {
    const parsed = ReviewPhotoUploadRequestSchema.safeParse(file);
    if (!parsed.success) return FAILURES.invalidFile;
    const context = await resolvePhotoContext(route);
    if (!context.ok) return context.failure;
    const outcome = await requestPhotoUpload(context.ctx, {
      profileId: context.profileId,
      reviewId: context.reviewId,
      file: parsed.data,
    });
    if (outcome.kind === 'not_found') return FAILURES.noReview;
    if (outcome.kind === 'full') return FAILURES.full;
    if (outcome.kind === 'busy') return FAILURES.busy;
    return {
      ok: true as const,
      photoId: outcome.photoId,
      url: outcome.url,
      headers: outcome.headers,
    };
  });
}

export type AttachReviewPhotoResult = { ok: true; photo: OwnReviewPhoto } | ReviewPhotoFailure;

export async function attachReviewPhoto(
  route: ReviewRouteParams,
  photoId: string
): Promise<AttachReviewPhotoResult> {
  return guard('attachReviewPhoto', async () => {
    if (typeof photoId !== 'string') return FAILURES.missing;
    const context = await resolvePhotoContext(route);
    if (!context.ok) return context.failure;
    const outcome = await ingestPhoto(context.ctx, {
      profileId: context.profileId,
      reviewId: context.reviewId,
      photoId,
    });
    switch (outcome.kind) {
      case 'not_found':
        return FAILURES.noReview;
      case 'missing':
        return FAILURES.missing;
      case 'full':
        return FAILURES.full;
      case 'rejected':
        return outcome.reason === 'too_large'
          ? FAILURES.tooLarge
          : outcome.reason === 'unsupported'
            ? FAILURES.unsupported
            : FAILURES.unreadable;
      case 'ok':
        if (outcome.requeued) {
          // 公開中だった口コミは審査中に戻って見えなくなるので、ページを作り直し、審査を走らせる
          for (const path of context.paths) revalidatePath(path);
          const { db } = context.ctx;
          const { reviewId, paths } = context;
          after(() => screenAfterSubmit(db, reviewId, paths));
        }
        return { ok: true as const, photo: outcome.photo };
    }
  });
}

export type ReviewPhotoChangeResult = { ok: true } | ReviewPhotoFailure;

export async function removeReviewPhoto(
  route: ReviewRouteParams,
  photoId: number
): Promise<ReviewPhotoChangeResult> {
  return guard('removeReviewPhoto', async () => {
    if (!Number.isInteger(photoId) || photoId <= 0) return FAILURES.unexpected;
    const context = await resolvePhotoContext(route);
    if (!context.ok) return context.failure;
    const outcome = await removePhoto(context.ctx, {
      profileId: context.profileId,
      reviewId: context.reviewId,
      photoId,
    });
    // 既に外れている (別の端末で外した) 時も、画面の結果は同じなので成功として返す
    return outcome.kind === 'removed' || outcome.kind === 'not_found'
      ? { ok: true as const }
      : FAILURES.unexpected;
  });
}

const PhotoIdsSchema = z.array(z.number().int().positive()).min(1).max(MAX_REVIEW_PHOTOS);

export async function reorderReviewPhotos(
  route: ReviewRouteParams,
  photoIds: number[]
): Promise<ReviewPhotoChangeResult> {
  return guard('reorderReviewPhotos', async () => {
    const ids = PhotoIdsSchema.safeParse(photoIds);
    if (!ids.success) return FAILURES.mismatch;
    const context = await resolvePhotoContext(route);
    if (!context.ok) return context.failure;
    const outcome = await reorderPhotos(context.ctx, {
      profileId: context.profileId,
      reviewId: context.reviewId,
      photoIds: ids.data,
    });
    if (outcome.kind === 'reordered') return { ok: true as const };
    return outcome.kind === 'mismatch' ? FAILURES.mismatch : FAILURES.noReview;
  });
}
