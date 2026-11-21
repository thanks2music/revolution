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
