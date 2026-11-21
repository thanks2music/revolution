import type { ReviewReasonCode, ReviewStatus } from '@revolution/schemas/review';

import { formatJstDotDate } from '@/lib/date';
import { REJECTION_REASON_LABELS } from '@/lib/reviews/labels';

/**
 * #12 マイページの「自分の口コミ」の 1 件の見せ方 (Figma `83:191`、one-more-time #162)。
 * 本人には状態をそのまま見せる (BOSS の確認待ちは審査中と同じに見せる)。
 */
export type OwnReviewTone = 'draft' | 'screening' | 'published' | 'problem';

export type OwnReviewView = {
  badge: string;
  tone: OwnReviewTone;
  /** 編集の入口の言葉 (どれも #7 の投稿のページを開く) */
  editLabel: string;
  /** 差し戻し・非公開の理由。それ以外の状態では null */
  reason: string | null;
};

const VIEWS = {
  draft: { badge: '下書き', tone: 'draft', editLabel: '続きを書く' },
  pending: { badge: '審査中', tone: 'screening', editLabel: '編集' },
  needs_review: { badge: '審査中', tone: 'screening', editLabel: '編集' },
  published: { badge: '公開中', tone: 'published', editLabel: '編集' },
  rejected: { badge: '差し戻し', tone: 'problem', editLabel: '直して出し直す' },
  hidden: { badge: '非公開', tone: 'problem', editLabel: '直して出し直す' },
} as const satisfies Record<ReviewStatus, Omit<OwnReviewView, 'reason'>>;

const REASON_PREFIX: Partial<Record<ReviewStatus, string>> = {
  rejected: '差し戻しの理由',
  hidden: '非公開の理由',
};

export function ownReviewView(input: {
  status: ReviewStatus;
  reasonCode: ReviewReasonCode | null;
  reasonNote: string | null;
}): OwnReviewView {
  const prefix = REASON_PREFIX[input.status];
  // 理由の言葉 (審査の 4 種) と運営の補足を並べる。どちらも無ければ理由の欄は出さない
  const label =
    input.reasonCode && input.reasonCode in REJECTION_REASON_LABELS
      ? REJECTION_REASON_LABELS[input.reasonCode as keyof typeof REJECTION_REASON_LABELS]
      : null;
  const detail = [label && `${label}。`, input.reasonNote].filter(Boolean).join('');
  const reason = prefix && detail ? `${prefix}: ${detail}` : null;
  return { ...VIEWS[input.status], reason };
}

/** 星の数を ★ と ☆ の 5 文字にする */
export function formatStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** 1 行の補足 (星・訪問日・参考になった・下書きの保存日) */
export function ownReviewMeta(input: {
  status: ReviewStatus;
  rating: number | null;
  visitedOn: string | null;
  helpfulCount: number;
  updatedAt: string;
}): string {
  const parts: string[] = [];
  if (input.rating !== null) parts.push(formatStars(input.rating));
  if (input.visitedOn) {
    const [year, month, day] = input.visitedOn.split('-').map(Number);
    parts.push(`${year}年${month}月${day}日 訪問`);
  }
  if (input.status === 'published' && input.helpfulCount > 0) {
    parts.push(`参考になった ${input.helpfulCount}`);
  }
  if (input.status === 'draft') parts.push(`${formatJstDotDate(input.updatedAt)} 保存`);
  return parts.join(' ・ ');
}
