import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

import { listOwnReviews } from '@/lib/reviews/own-reviews';

/** listOwnReviews が読んだ行だけを返す、最小の偽の DB */
function fakeDb(rows: unknown[]): SupabaseClient {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is']) query[name] = () => query;
  let orders = 0;
  query.order = () => (++orders === 2 ? Promise.resolve({ data: rows, error: null }) : query);
  return { from: () => query } as unknown as SupabaseClient;
}

const ROW = {
  id: 1,
  status: 'published',
  rating: 4,
  visited_on: '2026-11-20',
  helpful_count: 0,
  reason_code: null,
  reason_note: null,
  updated_at: '2026-11-21T00:00:00Z',
  occurrence: {
    slug: 'shibuya',
    status: 'ongoing',
    starts_on: '2026-11-01',
    ends_on: null,
    venue_label: null,
    venues: { name: '渋谷' },
    events: { id: 12, name: '企画', primaryCategory: { slug: 'collabo-cafe' } },
  },
};

describe('listOwnReviews', () => {
  it('読めない行が 1 件あっても、ほかの口コミは返し、読めない行は Sentry に送る', async () => {
    const list = await listOwnReviews(fakeDb([ROW, { ...ROW, id: 2, status: 'unknown' }]), 'p-1');

    expect(list.map(review => review.id)).toEqual([1]);
    expect(list[0]).toMatchObject({
      canEdit: true,
      occurrencePath: '/collabo-cafe/12/shibuya',
      route: { eventType: 'collabo-cafe', eventId: '12', occurrenceSlug: 'shibuya' },
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
