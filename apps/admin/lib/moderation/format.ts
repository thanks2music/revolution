import { REPORT_REASON_LABELS } from '@revolution/reviews/labels';
import type { ReviewQueueItem } from '@revolution/reviews/moderation';
import {
  REVIEW_REPORT_REASONS,
  REVIEW_SCREENING_REASONS,
  type ReviewReportReason,
} from '@revolution/schemas/review-constants';

/**
 * 管理アプリの表示の言葉 (Figma 13〜16、135:409)。DB と操作の層 (shared/reviews/moderation.ts) の値を、
 * 画面の言葉にするだけ
 */

export type QueueSection = {
  kind: ReviewQueueItem['kind'];
  title: string;
  note: string;
  items: ReviewQueueItem[];
};

const SECTIONS: Omit<QueueSection, 'items'>[] = [
  {
    kind: 'stuck',
    title: '止まっている口コミ',
    note: '審査中のまま 30 分以上。処理が途中で落ちた可能性があります',
  },
  {
    kind: 'ai_failure',
    title: 'AI の審査に失敗',
    note: 'やり直しても AI が答えなかった口コミです',
  },
  { kind: 'unsure', title: 'AI が迷った', note: 'AI が公開と差し戻しを決めきれなかった口コミです' },
];

/** 一覧の節 (止まっている → 失敗 → 迷った)。節の中は古い順 (DB の並びのまま)。空の節は出さない */
export function queueSections(items: ReviewQueueItem[]): QueueSection[] {
  return SECTIONS.map(section => ({
    ...section,
    items: items.filter(item => item.kind === section.kind),
  })).filter(section => section.items.length > 0);
}

/** 節の順に並べ直した一覧 (口コミの確認の「1 / 3」と前後の移動に使う) */
export function queueOrder(items: ReviewQueueItem[]): ReviewQueueItem[] {
  return queueSections(items).flatMap(section => section.items);
}

/** 経過時間 (例: 「42 分」「1 時間 5 分」「2 日」) */
export function elapsedLabel(since: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} 時間` : `${hours} 時間 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 日`;
}

/** 「42分前」の形 */
export function agoLabel(since: string, now: Date = new Date()): string {
  return `${elapsedLabel(since, now).replace(/ /g, '')}前`;
}

/** 日時 (JST、例: 2026.11.23 14:02) */
export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 日付 (JST、例: 2026年7月19日)。訪問日は日付だけの値 (YYYY-MM-DD) */
export function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/** 星 (例: ★★★★☆) */
export function starsLabel(rating: number | null): string {
  if (!rating) return '—';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/**
 * AI の審査の失敗の短い言葉と説明。ai_error は審査器の内部の文 (英語) なので、BOSS 向けの言葉にする。
 * 説明の後ろに元の文も小さく出す (原因を調べる時のため)
 */
export function aiFailureSummary(aiError: string | null): { label: string; detail: string } {
  const error = (aiError ?? '').toLowerCase();
  if (/timeout|timed out|deadline|aborted/.test(error)) {
    return { label: '時間切れ', detail: 'AI が時間内に答えませんでした。' };
  }
  if (/photos kept changing/.test(error)) {
    return {
      label: '写真の変化',
      detail: '審査の間に写真が何度も足し外しされ、審査できませんでした。',
    };
  }
  if (/photos could not be read/.test(error)) {
    return { label: '写真の読み込み', detail: '写真を読み込めず、審査できませんでした。' };
  }
  if (/prompt|gemini_api_key|not set/.test(error)) {
    return { label: '設定の不備', detail: '審査の設定 (プロンプトや鍵) が見つかりませんでした。' };
  }
  if (/429|rate|quota/.test(error)) {
    return { label: '回数の上限', detail: 'AI の呼び出しの上限に当たりました。' };
  }
  return { label: 'エラー', detail: 'AI の審査がエラーで止まりました。' };
}

/** 一覧の行の見出し (迷った理由の最初の 1 文。長ければ切る) */
export function headlineOf(aiReason: string | null, max = 28): string {
  const first = (aiReason ?? '').split(/[。\n]/)[0]?.trim() ?? '';
  if (!first) return 'AI が迷った';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

/**
 * 差し戻し・非公開・写真の非公開の理由の選択肢 (Figma 14・15・16)。短い言葉は通報の理由と同じ
 * (shared/reviews/labels.ts の REPORT_REASON_LABELS)。投稿者のマイページに出る長い言葉は REVIEW_REASON_LABELS。
 * 差し戻しは審査の 4 種、通報を受けた非公開と写真の非公開は通報の 8 つから選ぶ
 */
export const SCREENING_REASON_OPTIONS = REVIEW_SCREENING_REASONS.map(
  reason => [reason, REPORT_REASON_LABELS[reason]] as const
);
export const REPORT_REASON_OPTIONS = REVIEW_REPORT_REASONS.map(
  reason => [reason, REPORT_REASON_LABELS[reason]] as const
);

const STATUS_WORDS: Record<string, string> = {
  published: '公開',
  rejected: '差し戻し',
  needs_review: '迷った',
  pending: '審査中',
  hidden: '非公開',
};

/** BOSS の通報の処理 (0029) の言葉 */
const REPORT_ACTION_WORDS: Record<string, string> = {
  hidden: '非公開にした',
  kept: '直して公開のまま',
  dismissed: '問題なし',
};

/** 判断の記録の 1 行 (Figma F-10。例: 「AI: 迷った」「BOSS: 公開」「BOSS: もう一度 AI にかけた」) */
export type HistoryEntry = {
  id: number;
  actor: 'ai' | 'admin';
  action: string;
  toStatus: string;
  reasonCode: string | null;
  createdAt: string;
};

export function historyLine(
  event: Pick<HistoryEntry, 'actor' | 'action' | 'toStatus' | 'reasonCode'>
): {
  who: string;
  what: string;
} {
  if (event.actor === 'ai') {
    if (event.reasonCode === 'ai_failure') return { who: 'AI', what: '審査に失敗' };
    const reason = REPORT_REASON_LABELS[event.reasonCode as ReviewReportReason];
    const status = STATUS_WORDS[event.toStatus] ?? event.toStatus;
    return { who: 'AI', what: reason ? `${status} (${reason})` : status };
  }
  if (event.action === 'requeued') return { who: 'BOSS', what: 'もう一度 AI にかけた' };
  const reportAction = REPORT_ACTION_WORDS[event.action];
  if (reportAction) {
    const reason = REPORT_REASON_LABELS[event.reasonCode as ReviewReportReason];
    return { who: 'BOSS', what: `通報: ${reportAction}${reason ? ` (${reason})` : ''}` };
  }
  return { who: 'BOSS', what: STATUS_WORDS[event.toStatus] ?? event.toStatus };
}

/**
 * 口コミの確認の状態。確認待ち (迷った・失敗) と止まっている審査中は操作できる。審査中でまだ止まっていない
 * 口コミ (screening) は待つだけ。それ以外 (公開済み・差し戻し済み・下書き・非公開) は、開いている間か
 * その前に状態が変わった口コミ (Figma F-6 と同じ扱い)。止まっているかは DB が決める (admin_get_review の stuck)
 */
export type DetailKind = ReviewQueueItem['kind'] | 'screening' | 'closed';

export function detailKind(
  review: { status: string; reason_code: string | null },
  stuck: boolean
): DetailKind {
  if (review.status === 'pending') return stuck ? 'stuck' : 'screening';
  if (review.status !== 'needs_review') return 'closed';
  return review.reason_code === 'ai_failure' ? 'ai_failure' : 'unsure';
}

/** 位置 (例: 「1 / 3」)。一覧に無ければ null */
export function queuePosition(order: { reviewId: number }[], reviewId: number): string | null {
  const index = order.findIndex(item => item.reviewId === reviewId);
  return index < 0 ? null : `${index + 1} / ${order.length}`;
}

/** 通報された口コミの状態の言葉 (Figma 16 の「公開中」) */
const REVIEW_STATE_WORDS: Record<string, string> = {
  published: '公開中',
  pending: '審査中 (直された)',
  needs_review: '確認待ち',
  rejected: '差し戻し中',
  hidden: '非公開',
  draft: '下書き',
};

export function reviewStateLabel(status: string): string {
  return REVIEW_STATE_WORDS[status] ?? status;
}

/** 通報の理由ごとの件数 (例: 「グッズの譲渡・転売の呼びかけ（2）、宣伝・スパム・開催と無関係（1）」、Figma 16) */
export function reportReasonsLabel(reasons: { code: ReviewReportReason; count: number }[]): string {
  return reasons.map(({ code, count }) => `${REPORT_REASON_LABELS[code]}（${count}）`).join('、');
}
