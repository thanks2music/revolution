'use server';

/**
 * 口コミを書く開催を選ぶ (7-0) の「最近見た開催」(one-more-time #166)。
 *
 * 最近見た開催はブラウザに残している (`RecentOccurrences`)。その ID の開催を引いて返す。
 * 読むのは公開の情報だけ (確認済みの開催) なので、会員でなくても返してよい。
 */

import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { getReviewTargets, type ReviewTarget } from '@/lib/reviews/picker';

/** 最近見た開催の件数の上限 (ブラウザに残す数と同じ) */
const MAX_RECENT = 10;

export async function getRecentReviewTargets(occurrenceIds: number[]): Promise<ReviewTarget[]> {
  try {
    const ids = z.array(z.number().int().positive()).safeParse(occurrenceIds.slice(0, MAX_RECENT));
    if (!ids.success) return [];
    return await getReviewTargets(ids.data);
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getRecentReviewTargets' } });
    return [];
  }
}
