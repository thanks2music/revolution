import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { REVIEW_REASON_CODES, REVIEW_STATUSES } from '@revolution/schemas/review';

/**
 * #12 マイページの「自分の口コミ」(one-more-time #162)。
 *
 * 理由 (`reason_code` / `reason_note`) と本人の訪問日は anon / authenticated に GRANT していない列なので、
 * サーバーが service role で読み、会員の profiles.id で絞って本人にだけ返す。論理削除した口コミは出さない。
 */
const OwnReviewListRowSchema = z.object({
  id: z.number(),
  status: z.enum(REVIEW_STATUSES),
  rating: z.number().int().min(1).max(5).nullable(),
  visited_on: z.string().nullable(),
  helpful_count: z.number().int(),
  reason_code: z.enum(REVIEW_REASON_CODES).nullable(),
  reason_note: z.string().nullable(),
  updated_at: z.string(),
  occurrence: z.object({
    slug: z.string(),
    venue_label: z.string().nullable(),
    venues: z.object({ name: z.string() }).nullable(),
    events: z.object({
      id: z.number(),
      name: z.string(),
      primaryCategory: z.object({ slug: z.string() }),
    }),
  }),
});

export type OwnReviewListItem = {
  id: number;
  status: z.infer<typeof OwnReviewListRowSchema>['status'];
  rating: number | null;
  visitedOn: string | null;
  helpfulCount: number;
  reasonCode: z.infer<typeof OwnReviewListRowSchema>['reason_code'];
  reasonNote: string | null;
  updatedAt: string;
  eventName: string;
  /** 会場の名前。無ければ開催の表示名 */
  venueName: string | null;
  /** 開催のページの URL を作るのに要るもの */
  route: { eventId: number; eventType: string; occurrenceSlug: string };
};

const SELECT =
  'id, status, rating, visited_on, helpful_count, reason_code, reason_note, updated_at, ' +
  'occurrence:occurrences!occurrence_id(slug, venue_label, venues(name), ' +
  'events!inner(id, name, primaryCategory:categories!primary_category_id(slug)))';

/** 会員の口コミを、新しく書き換えた順に返す */
export async function listOwnReviews(
  db: SupabaseClient,
  profileId: string
): Promise<OwnReviewListItem[]> {
  const { data, error } = await db
    .from('reviews')
    .select(SELECT)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return z
    .array(OwnReviewListRowSchema)
    .parse(data ?? [])
    .map(row => ({
      id: row.id,
      status: row.status,
      rating: row.rating,
      visitedOn: row.visited_on,
      helpfulCount: row.helpful_count,
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      updatedAt: row.updated_at,
      eventName: row.occurrence.events.name,
      venueName: row.occurrence.venues?.name ?? row.occurrence.venue_label,
      route: {
        eventId: row.occurrence.events.id,
        eventType: row.occurrence.events.primaryCategory.slug,
        occurrenceSlug: row.occurrence.slug,
      },
    }));
}
