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

/** 訪問日に選べる最初と最後の日 (JST の YYYY-MM-DD) */
export type DateRange = { min: string; max: string };

export type AuthoringMode =
  { kind: 'blocked'; reason: string } | { kind: 'new' | 'draft' | 'edit'; range: DateRange };

const NO_RANGE_REASON = 'この開催には、まだ口コミを書けません。';

/**
 * 会員がこの開催の投稿のページで何をできるか (one-more-time #162)。投稿のページと Server Action の両方が使う。
 *
 * - 提出した口コミ (下書き以外) は、開催の状態に関わらず直せる (仕様: いつでも編集)。書けない開催
 *   (中止・開催前・日程未発表) や選べる日が無い開催では、前の訪問日だけを選べる (変えると DB のトリガが止める)
 * - 新しく書く・下書きは、開催中か終了の開催で、選べる訪問日がある時だけ
 */
export function authoringMode(input: {
  occurrenceStatus: OccurrenceStatus;
  startsOn: string | null;
  endsOn: string | null;
  today: string;
  own: { status: ReviewStatus; visitedOn: string | null } | null;
}): AuthoringMode {
  const range = visitDateRange(input.startsOn, input.endsOn, input.today);
  const { own } = input;
  if (own && own.status !== 'draft') {
    // 書けない開催 (中止など) では、訪問日を変えると DB のトリガが止めるので、前の訪問日に固定する
    const pinned = own.visitedOn ? { min: own.visitedOn, max: own.visitedOn } : null;
    const editRange = reviewBlockReason(input.occurrenceStatus) ? pinned : (range ?? pinned);
    return editRange
      ? { kind: 'edit', range: editRange }
      : { kind: 'blocked', reason: NO_RANGE_REASON };
  }
  const blocked = reviewBlockReason(input.occurrenceStatus) ?? (range ? null : NO_RANGE_REASON);
  if (blocked || !range) return { kind: 'blocked', reason: blocked ?? NO_RANGE_REASON };
  return { kind: own ? 'draft' : 'new', range };
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

/**
 * 写真を足すと審査し直しになる状態 (DB のトリガ `requeue_review_on_image_insert` と同じ列挙)。
 * 下書きと審査中は、そのまま (提出の時・審査の時に写真も見る)
 */
export function rescreensOnPhotoAdd(status: ReviewStatus): boolean {
  return (
    status === 'published' ||
    status === 'rejected' ||
    status === 'needs_review' ||
    status === 'hidden'
  );
}

/** 投稿者に理由を見せる状態 (差し戻しと非公開。どちらも理由を見て直せる、仕様 #156) */
export function explainsReason(status: ReviewStatus): status is 'rejected' | 'hidden' {
  return status === 'rejected' || status === 'hidden';
}

/**
 * 開催のページの「口コミの状態」(Figma 追加画面 `93:196`、one-more-time #166)。欄の出し方
 * (`reviewSectionMode`) と件数から選ぶ。null は「状態の部品を出さない」(中止・日程未発表は欄ごと出さず、
 * 開催中で口コミがある時は大きな「口コミを書く」だけを出す)
 */
export type ReviewStateKind = 'notYet' | 'empty' | 'ended';

export function reviewStateKind(
  status: OccurrenceStatus,
  ratingCount: number
): ReviewStateKind | null {
  const mode = reviewSectionMode(status);
  if (mode === 'none') return null;
  if (mode === 'notYet') return 'notYet';
  if (ratingCount === 0) return 'empty';
  return status === 'ended' ? 'ended' : null;
}
