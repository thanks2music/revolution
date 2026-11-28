'use server';

/**
 * プロフィール画像の Server Actions (one-more-time #171)。
 *
 * - requestAvatarUpload: 受け取り場所へ上げる署名付き URL を出す
 * - attachAvatar: 上げた画像を取り込み (正方形に変換して保管し、審査中にする)、応答の後に審査を走らせる
 * - removeAvatar: 画像を外す (審査中でも。外すと審査をやめる)
 *
 * オンボーディングの途中 (#11) でも使うので、ログインと profiles の行だけを求める (getCurrentMember は
 * オンボーディングの完了を求めるため使わない)。会員はログインから決め、クライアントから受け取らない。
 * throw せず型付きの結果を返し、想定外の失敗だけを Sentry に送る。
 */

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import {
  MAX_REVIEW_PHOTO_MB,
  ReviewPhotoUploadRequestSchema,
} from '@revolution/schemas/review-photo';

import { getCachedUser } from '@/lib/auth/current-user';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  attachAvatar as attachAvatarOperation,
  removeAvatar as removeAvatarOperation,
  requestAvatarUpload as requestAvatarUploadOperation,
  screenAvatar,
} from '@revolution/reviews/avatar/operations';
import { getAvatarScreener } from '@revolution/reviews/avatar/screener';
import { getReviewPhotoStorage, reviewPhotoKeyPrefix } from '@revolution/reviews/photos/storage';

export type AvatarFailure = { ok: false; error: string; needsAuth?: boolean };

const FAILURES = {
  needsLogin: { ok: false, error: 'ログインしてください', needsAuth: true },
  unavailable: { ok: false, error: '今は画像を設定できません。時間をおいてもう一度お試しください' },
  removed: { ok: false, error: 'プロフィール画像は設定できません' },
  busy: {
    ok: false,
    error: '取り込めていない画像が多いため、今は設定できません。明日以降にもう一度お試しください',
  },
  invalidFile: {
    ok: false,
    error: `JPEG・PNG・HEIC の、${MAX_REVIEW_PHOTO_MB}MB までの画像を選んでください`,
  },
  missing: { ok: false, error: '画像を受け取れませんでした。もう一度選び直してください' },
  tooLarge: { ok: false, error: `${MAX_REVIEW_PHOTO_MB}MB を超える画像は使えません` },
  unsupported: { ok: false, error: 'JPEG・PNG・HEIC の画像を選んでください' },
  unreadable: { ok: false, error: '画像を読み取れませんでした。別の画像を選んでください' },
  unexpected: {
    ok: false,
    error: '画像を保存できませんでした。時間をおいてもう一度お試しください',
  },
} as const satisfies Record<string, AvatarFailure>;

/** 画像を出すページ (本人の画面)。口コミのページは ISR の作り直しで反映される */
const AFFECTED_PATHS = ['/mypage', '/mypage/profile'];

async function resolveAvatarContext() {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return { ok: false as const, failure: FAILURES.needsLogin };
  const admin = createAdminClient();
  const storage = getReviewPhotoStorage();
  if (!admin || !storage) return { ok: false as const, failure: FAILURES.unavailable };
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false as const, failure: FAILURES.needsLogin };
  return {
    ok: true as const,
    profileId: data.id as string,
    ctx: { db: admin, storage, prefix: reviewPhotoKeyPrefix() },
  };
}

async function guard<T>(action: string, run: () => Promise<T>): Promise<T | AvatarFailure> {
  try {
    return await run();
  } catch (error) {
    Sentry.captureException(error, { tags: { action } });
    return FAILURES.unexpected;
  }
}

export type RequestAvatarUploadResult =
  { ok: true; imageId: string; url: string; headers: Record<string, string> } | AvatarFailure;

export async function requestAvatarUpload(file: {
  contentType: string;
  size: number;
}): Promise<RequestAvatarUploadResult> {
  return guard('requestAvatarUpload', async () => {
    const parsed = ReviewPhotoUploadRequestSchema.safeParse(file);
    if (!parsed.success) return FAILURES.invalidFile;
    const context = await resolveAvatarContext();
    if (!context.ok) return context.failure;
    const outcome = await requestAvatarUploadOperation(context.ctx, {
      profileId: context.profileId,
      file: parsed.data,
    });
    if (outcome.kind === 'removed') return FAILURES.removed;
    if (outcome.kind === 'busy') return FAILURES.busy;
    return { ok: true, imageId: outcome.imageId, url: outcome.url, headers: outcome.headers };
  });
}

export async function attachAvatar(imageId: string): Promise<{ ok: true } | AvatarFailure> {
  return guard('attachAvatar', async () => {
    const context = await resolveAvatarContext();
    if (!context.ok) return context.failure;
    const outcome = await attachAvatarOperation(context.ctx, {
      profileId: context.profileId,
      imageId,
    });
    switch (outcome.kind) {
      case 'already':
        // 同じ画像を 2 回送った。審査はもう走っている
        return { ok: true };
      case 'removed':
        return FAILURES.removed;
      case 'missing':
        return FAILURES.missing;
      case 'rejected':
        return outcome.reason === 'too_large'
          ? FAILURES.tooLarge
          : outcome.reason === 'unsupported'
            ? FAILURES.unsupported
            : FAILURES.unreadable;
      case 'ok': {
        const { profileId, ctx } = context;
        // 審査は応答の後に走らせる (会員は待たない)。結果は次に画面を開いた時に出る
        after(async () => {
          try {
            await screenAvatar(
              { db: ctx.db, storage: ctx.storage, screener: await getAvatarScreener() },
              { profileId, key: outcome.key }
            );
            for (const path of AFFECTED_PATHS) revalidatePath(path);
          } catch (error) {
            Sentry.captureException(error, { tags: { action: 'screenAvatar' } });
          }
        });
        for (const path of AFFECTED_PATHS) revalidatePath(path);
        return { ok: true };
      }
    }
  });
}

export async function removeAvatar(): Promise<{ ok: true } | AvatarFailure> {
  return guard('removeAvatar', async () => {
    const context = await resolveAvatarContext();
    if (!context.ok) return context.failure;
    const outcome = await removeAvatarOperation(context.ctx, context.profileId);
    if (outcome.kind === 'removed') return FAILURES.removed;
    for (const path of AFFECTED_PATHS) revalidatePath(path);
    return { ok: true };
  });
}
