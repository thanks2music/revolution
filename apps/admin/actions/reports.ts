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

import { handleReviewReports } from '@revolution/reviews/reports';
import { REVIEW_REPORT_REASONS } from '@revolution/schemas/review';

import { moderationDeps } from '@/lib/moderation/deps';
import type { NoticeKind } from '@/lib/moderation/notice';
import { PhotoDecisionsSchema } from '@/lib/moderation/photo-decision';

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
  const { title, ...rest } = parsed.data;
  let outcome;
  try {
    const deps = await moderationDeps();
    if (!deps) return { kind: 'forbidden' };
    outcome = await handleReviewReports(deps, rest);
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'admin.handleReviewReports' } });
    return { kind: 'error' };
  }
  if (outcome.kind !== 'applied') return outcome;
  // 知らせは DB が記録した処理から決める。redirect は例外で戻るので、try の外で呼ぶ
  const notice: NoticeKind = outcome.action;
  redirect(`/reports?${new URLSearchParams({ notice, title })}`);
}
