'use server';

/**
 * 口コミの通報 (S4 / one-more-time #168)。
 *
 * - ログインしていなくても通報できる。通報した人は、会員なら profiles.id、未ログインなら端末の cookie の乱数
 *   (無ければここで作る)。同じ人から同じ口コミへの未処理の通報は DB が 1 件にまとめる。IP は持たない
 * - 書き込みはこのサーバーだけ。service role で `submit_review_report` を呼ぶ (anon には表も関数も渡さない)
 * - 通報は AI を通さない。BOSS が管理アプリで処理する
 * - 開催のページは ISR のまま。cookie はこの Server Action の中でだけ読み書きする
 *
 * throw せず型付きの結果を返す。公開中でない口コミ・不正な理由は利用者の操作なので Sentry に送らない。
 */

import { randomUUID } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { getCurrentMember } from '@/lib/auth/member';
import { createAdminClient } from '@/lib/supabase/admin';
import { REVIEW_REPORT_REASONS } from '@revolution/schemas/review-constants';

/** 未ログインの通報の端末の印。乱数だけで、ほかの情報は持たない */
const REPORTER_DEVICE_COOKIE = 'review_reporter';
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const ReportInputSchema = z.object({
  reviewId: z.number().int().positive(),
  reasonCode: z.enum(REVIEW_REPORT_REASONS),
});

export type ReportReviewResult = { ok: true } | { ok: false; error: string };

const FAILED = '送れませんでした。時間をおいて、もう一度お試しください';

/** 公開中の口コミを通報する。同じ人が何度送っても結果は同じ (受け付けました) */
export async function reportReview(
  reviewId: number,
  reasonCode: string
): Promise<ReportReviewResult> {
  const input = ReportInputSchema.safeParse({ reviewId, reasonCode });
  if (!input.success) return { ok: false, error: '通報の理由を選んでください' };

  try {
    const db = createAdminClient();
    if (!db) throw new Error('SUPABASE_SECRET_KEY is not set');

    const member = await getCurrentMember();
    const reporter = member.ok
      ? { profileId: member.profileId, deviceId: null }
      : { profileId: null, deviceId: await deviceId() };

    const { data, error } = await db.rpc('submit_review_report', {
      p_review_id: input.data.reviewId,
      p_reason_code: input.data.reasonCode,
      p_reporter_profile_id: reporter.profileId,
      p_reporter_device_id: reporter.deviceId,
    });
    if (error) throw error;
    if (data === 'not_found') {
      return {
        ok: false,
        error: 'この口コミは通報できません (公開をやめたか、消された可能性があります)',
      };
    }
    return { ok: true };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'reportReview' } });
    return { ok: false, error: FAILED };
  }
}

/** 端末の印 (cookie)。無いか形が違えば作り直す */
async function deviceId(): Promise<string> {
  const store = await cookies();
  const current = store.get(REPORTER_DEVICE_COOKIE)?.value;
  if (current && z.uuid().safeParse(current).success) return current;

  const created = randomUUID();
  store.set(REPORTER_DEVICE_COOKIE, created, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return created;
}
