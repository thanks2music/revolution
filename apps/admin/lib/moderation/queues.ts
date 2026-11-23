import 'server-only';

import { redirect } from 'next/navigation';

import type { SupabaseClient } from '@supabase/supabase-js';

import { listReviewQueue } from '@revolution/reviews/moderation';
import { listReportQueue } from '@revolution/reviews/reports';

/**
 * 一覧の 2 つのタブ (確認待ちと通報) の中身と件数。どのページもタブに両方の件数を出すので、両方を読む。
 * admin でなければ /forbidden へ送る
 */
export async function loadQueues(adminDb: SupabaseClient) {
  const [queue, reports] = await Promise.all([listReviewQueue(adminDb), listReportQueue(adminDb)]);
  if (queue.kind === 'forbidden' || reports.kind === 'forbidden') redirect('/forbidden');
  return {
    queue: queue.items,
    reports: reports.items,
    counts: { queue: queue.items.length, reports: reports.items.length },
  };
}
