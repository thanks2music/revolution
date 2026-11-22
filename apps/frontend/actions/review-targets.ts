'use server';

/**
 * 口コミを書く開催を選ぶ (7-0) の「最近見た開催」(one-more-time #166)。
 *
 * 最近見た開催はブラウザに残している (`RecentOccurrences`)。その ID の開催を引いて返す。
 * 読むのは公開の情報だけ (確認済みの開催) なので、会員でなくても返してよい。
 */

import * as Sentry from '@sentry/nextjs';

import { getReviewTargets, type ReviewTarget } from '@/lib/reviews/picker';
import { RECENT_OCCURRENCES_LIMIT } from '@/lib/reviews/recent-occurrences';
import { parseIdList } from '@/lib/validation/id-list';

export async function getRecentReviewTargets(occurrenceIds: number[]): Promise<ReviewTarget[]> {
  try {
    return await getReviewTargets(parseIdList(occurrenceIds, RECENT_OCCURRENCES_LIMIT));
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getRecentReviewTargets' } });
    return [];
  }
}
