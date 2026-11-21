import type { OccurrenceStatus } from '@revolution/schemas/occurrence';
import type { ReviewStatus } from '@revolution/schemas/review';

/**
 * 開催の状態から、口コミを書けない理由を返す (書ける時は null)。
 *
 * 書けるのは開催中か終了の開催だけ (仕様 #156)。DB のトリガ (`private.check_review_occurrence`) も
 * 同じ規則で止めている。画面 (投稿のページ) と提出 (Server Action) の両方がこれを使い、判定を 1 つにする。
 * 状態が増えたら `satisfies` が型で知らせる。
 */
const BLOCK_REASONS = {
  ongoing: null,
  ended: null,
  scheduled: 'この開催はまだ始まっていません。開催が始まったら口コミを書けます。',
  unscheduled: 'この開催は日程がまだ発表されていないため、口コミを書けません。',
  cancelled: 'この開催は中止になったため、口コミを書けません。',
} as const satisfies Record<OccurrenceStatus, string | null>;

export function reviewBlockReason(status: OccurrenceStatus): string | null {
  return BLOCK_REASONS[status];
}

/**
 * 訪問日に選べる範囲 (開始日 〜 終了日と今日の早い方、どれも JST の YYYY-MM-DD)。
 * 開始日が無い・今日より後で範囲が空になる時は null (書けない画面に倒す。状態の判定とずれた時の守り)
 */
export function visitDateRange(
  startsOn: string | null,
  endsOn: string | null,
  today: string
): { min: string; max: string } | null {
  if (!startsOn) return null;
  const max = endsOn && endsOn < today ? endsOn : today;
  return startsOn <= max ? { min: startsOn, max } : null;
}

/**
 * 開催のページの口コミの欄の出し方 (仕様 #156)。
 * - full: 評価・投稿の入口・口コミの一覧 (開催中・終了)
 * - notYet: 始まったら書けることだけ (開催前)
 * - none: 欄を出さない (中止・日程未発表)
 */
export type ReviewSectionMode = 'full' | 'notYet' | 'none';

const SECTION_MODES = {
  ongoing: 'full',
  ended: 'full',
  scheduled: 'notYet',
  unscheduled: 'none',
  cancelled: 'none',
} as const satisfies Record<OccurrenceStatus, ReviewSectionMode>;

export function reviewSectionMode(status: OccurrenceStatus): ReviewSectionMode {
  return SECTION_MODES[status];
}

/**
 * 口コミの状態を、投稿者本人にどう見せるか (shared/schemas/review.ts の状態の表)。
 * BOSS の確認待ち (AI 審査の失敗を含む) は、本人には審査中と同じに見せる。下書きは出さない
 */
export type OwnReviewStatus = 'screening' | 'published' | 'rejected' | 'hidden';

const OWN_STATUSES = {
  draft: null,
  pending: 'screening',
  needs_review: 'screening',
  published: 'published',
  rejected: 'rejected',
  hidden: 'hidden',
} as const satisfies Record<ReviewStatus, OwnReviewStatus | null>;

export function ownReviewStatus(status: ReviewStatus): OwnReviewStatus | null {
  return OWN_STATUSES[status];
}
