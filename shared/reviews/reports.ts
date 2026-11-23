import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  REVIEW_REPORT_REASONS,
  REVIEW_STATUSES,
  type ReviewReportReason,
  type ReviewStatus,
} from '@revolution/schemas/review';

import {
  isForbidden,
  toPhotoMarks,
  toWriteOutcome,
  type ModerationDeps,
  type PhotoDecision,
} from './moderation';
import { syncPhotoDeliverySafely } from './photos/delivery';

/**
 * 通報の処理 (管理アプリ、one-more-time #168)。通報の一覧と、通報された口コミの処理。
 * 書き方は moderation.ts と同じ: BOSS のログインのクライアントで admin の DB の関数 (migration 0029) を呼び、
 * 配信側の写真の同期は service role で行う。口コミの確認 (写真・判断の記録・未処理の通報) は
 * moderation.ts の `getReviewForModeration` を使う
 */

const ReportQueueRowSchema = z.object({
  review_id: z.number(),
  status: z.enum(REVIEW_STATUSES),
  event_name: z.string(),
  venue_name: z.string().nullable(),
  report_count: z.number().int().min(1),
  first_reported_at: z.string(),
  reasons: z.partialRecord(z.enum(REVIEW_REPORT_REASONS), z.number().int().min(1)),
});

export type ReportQueueItem = {
  reviewId: number;
  status: ReviewStatus;
  eventName: string;
  venueName: string | null;
  reportCount: number;
  firstReportedAt: string;
  /** 理由ごとの件数 (多い順。同じ数なら理由の並び順) */
  reasons: { code: ReviewReportReason; count: number }[];
};

/** 理由ごとの件数を、多い順 (同じ数なら REVIEW_REPORT_REASONS の並び順) に並べる */
export function sortReasonCounts(
  counts: Partial<Record<ReviewReportReason, number>>
): { code: ReviewReportReason; count: number }[] {
  return REVIEW_REPORT_REASONS.flatMap(code =>
    counts[code] ? [{ code, count: counts[code] }] : []
  ).sort((a, b) => b.count - a.count);
}

export async function listReportQueue(
  adminDb: SupabaseClient
): Promise<{ kind: 'ok'; items: ReportQueueItem[] } | { kind: 'forbidden' }> {
  const { data, error } = await adminDb.rpc('admin_list_review_reports');
  if (isForbidden(error)) return { kind: 'forbidden' };
  // 0029 の前の DB (アプリの deploy が migration より先に終わった時) では関数が無い。確認待ちの一覧まで
  // 止めないよう、通報は無いものとして扱う
  if (error?.code === 'PGRST202') return { kind: 'ok', items: [] };
  if (error) throw error;
  const items = z
    .array(ReportQueueRowSchema)
    .parse(data ?? [])
    .map(row => ({
      reviewId: row.review_id,
      status: row.status,
      eventName: row.event_name,
      venueName: row.venue_name,
      reportCount: row.report_count,
      firstReportedAt: row.first_reported_at,
      reasons: sortReasonCounts(row.reasons),
    }));
  return { kind: 'ok', items };
}

export type ReportOutcome =
  /** 非公開にする。理由は通報の 8 つから、ひとことは任意 (投稿者のマイページに出る) */
  | { outcome: 'hide'; reasonCode: ReviewReportReason; reasonNote: string | null }
  /** 公開のまま (ネタバレの印と写真の非公開を当てる。何も変えなければ「問題なし」) */
  | { outcome: 'keep' };

/** 記録した処理: 非公開にした / 直して公開のまま / 問題なし (admin_handle_review_reports が返す値) */
export const REPORT_HANDLING_ACTIONS = ['hidden', 'kept', 'dismissed'] as const;
export type ReportAction = (typeof REPORT_HANDLING_ACTIONS)[number];

function isReportAction(value: unknown): value is ReportAction {
  return REPORT_HANDLING_ACTIONS.some(action => action === value);
}

export type ReportWriteOutcome =
  | { kind: 'applied'; action: ReportAction }
  /** 読んだ後に投稿者が出し直した・削除した、または見た通報がもう閉じていた (別のタブで処理した) */
  | { kind: 'superseded' }
  | { kind: 'photos_changed' }
  /** 口コミが公開でなくなっていた (編集されて審査中など)。変えずに閉じることだけができる */
  | { kind: 'not_published' }
  | { kind: 'forbidden' };

/**
 * 通報された口コミを処理し、画面で見た通報 (`reportIds`) を閉じる。`photos` は読んだ写真の全部の判断、
 * `hasSpoiler` は画面のネタバレの印。読んだ時の `submittedAt` と写真の集まりが今と違えば書かない。
 * 書けたら配信側の写真を合わせる (非公開にした口コミ・写真を消す)
 */
export async function handleReviewReports(
  deps: ModerationDeps,
  input: {
    reviewId: number;
    submittedAt: string;
    reportIds: number[];
    hasSpoiler: boolean;
    photos: PhotoDecision[];
  } & ReportOutcome
): Promise<ReportWriteOutcome> {
  const { data, error } = await deps.adminDb.rpc('admin_handle_review_reports', {
    p_review_id: input.reviewId,
    p_submitted_at: input.submittedAt,
    p_report_ids: input.reportIds,
    p_outcome: input.outcome,
    p_reason_code: input.outcome === 'hide' ? input.reasonCode : null,
    p_reason_note: input.outcome === 'hide' ? input.reasonNote : null,
    p_has_spoiler: input.hasSpoiler,
    p_photo_marks: toPhotoMarks(input.photos),
  });
  if (!error && isReportAction(data)) {
    // 写真か状態が変わった時だけ配信側を合わせる (問題なしで閉じた時は何も変わっていない)
    if (data !== 'dismissed' && deps.storage) {
      await syncPhotoDeliverySafely({ db: deps.serviceDb, storage: deps.storage }, input.reviewId);
    }
    return { kind: 'applied', action: data };
  }
  if (!error && data === 'not_published') return { kind: 'not_published' };
  const outcome = toWriteOutcome(data, error);
  if (outcome.kind === 'applied') throw new Error(`unexpected report result: ${String(data)}`);
  return outcome;
}
