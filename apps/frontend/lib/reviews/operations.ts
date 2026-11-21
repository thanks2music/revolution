import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReviewReasonCode, ReviewStatus } from '@revolution/schemas/review';

import type { ReviewScreener, ReviewScreeningResult } from './screener/types';

/**
 * 口コミの操作の層 (仕様: 審査・管理・通報の 3 つの入口が同じ関数を通る)。
 *
 * ここでは「提出された口コミを審査して、結果を書く」を持つ。書き込みは service role のクライアントで行う
 * (投稿者は状態・理由・AI の記録を書けない。列単位の GRANT とトリガで止めている)。
 *
 * - 読んだ時点の `submitted_at` と状態 (審査中) を条件にして書く (compare-and-set)。審査の間に投稿者が
 *   内容を変えて提出し直すと `submitted_at` が変わり、古い本文の審査結果で上書きしない
 * - 審査中でない口コミには何もしない (二重の実行や、管理画面で先に判断された物)
 * - 審査器は例外を投げない。失敗は「AI 審査の失敗」として BOSS の確認待ちに回す
 */

export type ScreenReviewOutcome =
  /** 審査の結果を書いた */
  | { kind: 'screened'; status: Extract<ReviewStatus, 'published' | 'rejected' | 'needs_review'>; occurrenceId: number }
  /** 審査中でない・見つからない・審査の間に提出し直された (何も書いていない) */
  | { kind: 'skipped'; reason: 'not_found' | 'not_pending' | 'superseded' };

type ScreeningWrite = {
  status: Extract<ReviewStatus, 'published' | 'rejected' | 'needs_review'>;
  reason_code: ReviewReasonCode | null;
  ai_reason: string | null;
  ai_error: string | null;
  ai_model: string | null;
};

/** 審査器の結果を、口コミに書く値にする */
export function toScreeningWrite(result: ReviewScreeningResult): ScreeningWrite {
  if (!result.ok) {
    return {
      status: 'needs_review',
      reason_code: 'ai_failure',
      ai_reason: null,
      ai_error: result.error,
      ai_model: result.model,
    };
  }
  const common = { ai_reason: result.reason, ai_error: null, ai_model: result.model };
  switch (result.decision) {
    case 'publish':
      return { status: 'published', reason_code: null, ...common };
    case 'reject':
      return { status: 'rejected', reason_code: result.reasonCode, ...common };
    case 'unsure':
      return { status: 'needs_review', reason_code: null, ...common };
  }
}

export async function screenSubmittedReview(
  reviewId: number,
  deps: { screener: ReviewScreener; db: SupabaseClient; now?: () => Date },
): Promise<ScreenReviewOutcome> {
  const { data: review, error: readError } = await deps.db
    .from('reviews')
    .select('id, status, body, submitted_at, occurrence_id, deleted_at')
    .eq('id', reviewId)
    .maybeSingle();
  if (readError) throw readError;
  if (!review || review.deleted_at) return { kind: 'skipped', reason: 'not_found' };
  if (review.status !== 'pending') return { kind: 'skipped', reason: 'not_pending' };

  const result = await deps.screener.screen({ body: review.body });
  const write = toScreeningWrite(result);

  const { data: updated, error: writeError } = await deps.db
    .from('reviews')
    .update({ ...write, ai_screened_at: (deps.now?.() ?? new Date()).toISOString() })
    .eq('id', reviewId)
    .eq('status', 'pending')
    .eq('submitted_at', review.submitted_at)
    .is('deleted_at', null)
    .select('id');
  if (writeError) throw writeError;
  if (!updated || updated.length === 0) return { kind: 'skipped', reason: 'superseded' };

  return { kind: 'screened', status: write.status, occurrenceId: review.occurrence_id };
}
