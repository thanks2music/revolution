'use server';

/**
 * BOSS の操作 (one-more-time #167)。公開・差し戻し・もう一度 AI にかける。
 *
 * - admin かは Auth のサーバーに聞いて確かめ (getAdminSession)、DB の関数の中でも確かめる (二段)
 * - 書けたら一覧へ戻し、知らせ (トースト) を出す (Figma 13・F-9)
 * - 書けなかった理由は型で返す: 状態が変わった (F-6) / 写真が変わった (F-7) / 保存できなかった (F-8)
 * - もう一度 AI にかけた後の審査は、応答の後に走らせる (after)。結果は数分で出る (Figma 13 のトースト)
 */
import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';

import {
  decideReview,
  requeueReview,
  type ModerationDeps,
  type PhotoDecision,
} from '@revolution/reviews/moderation';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { getReviewScreener } from '@revolution/reviews/screener';
import { REVIEW_SCREENING_REASONS } from '@revolution/schemas/review';

import { moderationDeps } from '@/lib/moderation/deps';
import type { NoticeKind } from '@/lib/moderation/notice';
import { PhotoDecisionsSchema } from '@/lib/moderation/photo-decision';

export type ModerationActionResult =
  { kind: 'superseded' } | { kind: 'photos_changed' } | { kind: 'forbidden' } | { kind: 'error' };

const TargetSchema = z.object({
  reviewId: z.number().int().positive(),
  submittedAt: z.string().min(1),
  /** 知らせに出す名前 (企画と会場)。知らせにしか使わないので、長い名前は切って判断を止めない */
  title: z.string().transform(title => title.slice(0, 200)),
});

const DecideSchema = TargetSchema.extend({ photos: PhotoDecisionsSchema });

const RejectSchema = DecideSchema.extend({
  reasonCode: z.enum(REVIEW_SCREENING_REASONS),
  reasonNote: z.string().max(500).nullable(),
});

function noticeUrl(notice: NoticeKind, title: string): string {
  return `/?${new URLSearchParams({ notice, title })}`;
}

export async function publishReview(input: z.input<typeof DecideSchema>) {
  return decide(input, null);
}

export async function rejectReview(input: z.input<typeof RejectSchema>) {
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) return { kind: 'error' } satisfies ModerationActionResult;
  return decide(parsed.data, {
    reasonCode: parsed.data.reasonCode,
    reasonNote: parsed.data.reasonNote,
  });
}

async function decide(
  input: z.input<typeof DecideSchema>,
  reject: {
    reasonCode: (typeof REVIEW_SCREENING_REASONS)[number];
    reasonNote: string | null;
  } | null
): Promise<ModerationActionResult> {
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { kind: 'error' };
  let outcome;
  try {
    const deps = await moderationDeps();
    if (!deps) return { kind: 'forbidden' };
    const target = {
      reviewId: parsed.data.reviewId,
      submittedAt: parsed.data.submittedAt,
      photos: parsed.data.photos as PhotoDecision[],
    };
    outcome = await decideReview(
      deps,
      reject ? { ...target, decision: 'reject', ...reject } : { ...target, decision: 'publish' }
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'admin.decideReview' } });
    return { kind: 'error' };
  }
  if (outcome.kind !== 'applied') return outcome;
  // redirect は例外で戻るので、try の外で呼ぶ
  redirect(noticeUrl(reject ? 'rejected' : 'published', parsed.data.title));
}

export async function requeueReviewAction(
  input: z.input<typeof TargetSchema>
): Promise<ModerationActionResult> {
  const parsed = TargetSchema.safeParse(input);
  if (!parsed.success) return { kind: 'error' };
  let outcome;
  try {
    const deps = await moderationDeps();
    if (!deps) return { kind: 'forbidden' };
    outcome = await requeueReview(
      { ...deps, screener: await getReviewScreener(), schedule: task => after(task) },
      { reviewId: parsed.data.reviewId, submittedAt: parsed.data.submittedAt }
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'admin.requeueReview' } });
    return { kind: 'error' };
  }
  if (outcome.kind !== 'applied') return outcome;
  redirect(noticeUrl('requeued', parsed.data.title));
}
