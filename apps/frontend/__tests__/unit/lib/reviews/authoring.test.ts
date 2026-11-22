import type { SupabaseClient } from '@supabase/supabase-js';

import { findOwnReview } from '@/lib/reviews/authoring';

/** findOwnReview が読んだ行だけを返す、最小の偽の DB */
function fakeDb(row: Record<string, unknown> | null): SupabaseClient {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is']) query[name] = () => query;
  query.maybeSingle = async () => ({ data: row, error: null });
  return { from: () => query } as unknown as SupabaseClient;
}

const ROW = {
  id: 9,
  status: 'hidden',
  rating: 3,
  visited_on: '2026-11-20',
  attendance: null,
  food_cost_band: null,
  goods_cost_band: null,
  body: '本文',
  has_spoiler: false,
  reason_code: 'spam',
  reason_note: null,
  submitted_at: '2026-11-21T00:00:00Z',
};

describe('findOwnReview', () => {
  it('列を画面の名前にして返す', async () => {
    await expect(findOwnReview(fakeDb(ROW), 'profile-1', 34)).resolves.toMatchObject({
      id: 9,
      status: 'hidden',
      visitedOn: '2026-11-20',
      reasonCode: 'spam',
      submittedAt: '2026-11-21T00:00:00Z',
    });
  });

  it('知らない理由のコード (後で足す通報の理由など) は null にし、読むのを止めない', async () => {
    await expect(
      findOwnReview(fakeDb({ ...ROW, reason_code: 'report_future_reason' }), 'profile-1', 34)
    ).resolves.toMatchObject({ reasonCode: null, status: 'hidden' });
  });

  it('口コミが無ければ null', async () => {
    await expect(findOwnReview(fakeDb(null), 'profile-1', 34)).resolves.toBeNull();
  });
});
