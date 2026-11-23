'use server';

/**
 * BOSS の通報の処理 (one-more-time #168)。非公開にする / 直して公開のままにする / 問題なしにする。
 *
 * - admin かは Auth のサーバーに聞いて確かめ (getAdminSession)、DB の関数の中でも確かめる (二段)
 * - 書けたら通報の一覧へ戻し、知らせを出す
 * - 書けなかった理由は型で返す: 状態が変わった / 写真が変わった / 公開でなくなった / 保存できなかった
 */
import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { PhotoDecision } from '@revolution/reviews/moderation';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { handleReviewReports } from '@revolution/reviews/reports';
import { REVIEW_REPORT_REASONS } from '@revolution/schemas/review';

import { getAdminSession } from '@/lib/auth/admin';
import type { NoticeKind } from '@/lib/moderation/notice';
import { PhotoDecisionsSchema } from '@/lib/moderation/photo-decision';
import { createServiceClient } from '@/lib/supabase/service';

export type ReportActionResult =
  | { kind: 'superseded' }
  | { kind: 'photos_changed' }
  | { kind: 'not_published' }
  | { kind: 'forbidden' }
  | { kind: 'error' };

const HandleSchema = z
  .object({
    reviewId: z.number().int().positive(),
    submittedAt: z.string().min(1),
    /** 知らせに出す名前 (企画と会場) */
    title: z.string().transform(title => title.slice(0, 200)),
    /** 公開のまま閉じる時に、ネタバレの印か写真を変えたか (知らせの言葉を分けるだけ。DB は自分で比べる) */
    changed: z.boolean(),
    /** 画面で見た未処理の通報 (これだけを閉じる) */
    reportIds: z.array(z.number().int().positive()).max(500),
    hasSpoiler: z.boolean(),
    photos: PhotoDecisionsSchema,
  })
  .and(
    z.discriminatedUnion('outcome', [
      z.object({
        outcome: z.literal('hide'),
        reasonCode: z.enum(REVIEW_REPORT_REASONS),
        reasonNote: z.string().max(500).nullable(),
      }),
      z.object({ outcome: z.literal('keep') }),
    ])
  );

export async function handleReportsAction(
  input: z.input<typeof HandleSchema>
): Promise<ReportActionResult> {
  const parsed = HandleSchema.safeParse(input);
  if (!parsed.success) return { kind: 'error' };
  const { title, changed, ...rest } = parsed.data;
  let outcome;
  try {
    const session = await getAdminSession();
    if (!session) return { kind: 'forbidden' };
    const serviceDb = createServiceClient();
    if (!serviceDb) throw new Error('SUPABASE_SECRET_KEY is not set');
    outcome = await handleReviewReports(
      { adminDb: session.supabase, serviceDb, storage: getReviewPhotoStorage() },
      { ...rest, photos: rest.photos as PhotoDecision[] }
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'admin.handleReviewReports' } });
    return { kind: 'error' };
  }
  if (outcome.kind !== 'applied') return outcome;
  const notice: NoticeKind = rest.outcome === 'hide' ? 'hidden' : changed ? 'kept' : 'dismissed';
  // redirect は例外で戻るので、try の外で呼ぶ
  redirect(`/reports?${new URLSearchParams({ notice, title })}`);
}
