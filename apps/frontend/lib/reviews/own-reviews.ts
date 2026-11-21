import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { OccurrenceStatusSchema } from '@revolution/schemas/occurrence';
import { REVIEW_REASON_CODES, REVIEW_STATUSES } from '@revolution/schemas/review';

import { todayInJst } from '@/lib/occurrence/status';
import { authoringMode } from '@/lib/reviews/eligibility';

/**
 * #12 マイページの「自分の口コミ」(one-more-time #162)。
 *
 * 理由 (`reason_code` / `reason_note`) と本人の訪問日は anon / authenticated に GRANT していない列なので、
 * サーバーが service role で読み、会員の profiles.id で絞って本人にだけ返す。論理削除した口コミは出さない。
 *
 * service role は RLS を通らないので、公開している (verified) 開催の口コミだけに自分で絞る
 * (公開をやめた開催の口コミは、開くことも削除もできないため)。開催の状態は `occurrence_view` の判定を使う。
 */
const OwnReviewListRowSchema = z
  .object({
    id: z.number(),
    status: z.enum(REVIEW_STATUSES),
    rating: z.number().int().min(1).max(5).nullable(),
    visited_on: z.string().nullable(),
    helpful_count: z.number().int(),
    // 知らない値 (後で足す通報の理由など) で一覧ごと出せなくならないよう、読めなければ null
    reason_code: z.enum(REVIEW_REASON_CODES).nullable().catch(null),
    reason_note: z.string().nullable(),
    updated_at: z.string(),
    occurrence: z.object({
      slug: z.string(),
      status: OccurrenceStatusSchema,
      starts_on: z.string().nullable(),
      ends_on: z.string().nullable(),
      venue_label: z.string().nullable(),
      venues: z.object({ name: z.string() }).nullable(),
      events: z.object({
        id: z.number(),
        name: z.string(),
        primaryCategory: z.object({ slug: z.string() }),
      }),
    }),
  })
  .transform(row => ({
    id: row.id,
    status: row.status,
    rating: row.rating,
    visitedOn: row.visited_on,
    helpfulCount: row.helpful_count,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    updatedAt: row.updated_at,
    eventName: row.occurrence.events.name,
    /** 会場の名前。無ければ開催の表示名 */
    venueName: row.occurrence.venues?.name ?? row.occurrence.venue_label,
    /** 開催のページの URL を作るのに要るもの */
    route: {
      eventId: row.occurrence.events.id,
      eventType: row.occurrence.events.primaryCategory.slug,
      occurrenceSlug: row.occurrence.slug,
    },
    /** 投稿のページで続き・編集ができるか (中止になった開催の下書きなどは、削除だけ) */
    canEdit:
      authoringMode({
        occurrenceStatus: row.occurrence.status,
        startsOn: row.occurrence.starts_on,
        endsOn: row.occurrence.ends_on,
        today: todayInJst(),
        own: { status: row.status, visitedOn: row.visited_on },
      }).kind !== 'blocked',
  }));

export type OwnReviewListItem = z.output<typeof OwnReviewListRowSchema>;

const SELECT =
  'id, status, rating, visited_on, helpful_count, reason_code, reason_note, updated_at, ' +
  'occurrence:occurrence_view!occurrence_id!inner(slug, status, starts_on, ends_on, venue_label, verified, ' +
  'venues(name), events!inner(id, name, primaryCategory:categories!primary_category_id(slug)))';

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
    .eq('occurrence.verified', true)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return z.array(OwnReviewListRowSchema).parse(data ?? []);
}
