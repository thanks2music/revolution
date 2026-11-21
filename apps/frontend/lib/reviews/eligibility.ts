import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

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
