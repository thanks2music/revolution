import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import {
  REVIEW_REASON_CODES,
  REVIEW_SCREENING_REASONS,
  REVIEW_STATUSES,
  type ReviewScreeningReason,
} from '@revolution/schemas/review';

import type { ReviewRouteParams } from '@/actions/review';
import { todayInJst } from '@/lib/occurrence/status';
import {
  storedVariantKey,
  variantWidthAtMost,
  type ReviewPhotoStorage,
} from '@revolution/reviews/photos/storage';
import {
  REVIEW_TARGET_COLUMNS,
  ReviewTargetRowSchema,
  toTarget,
  type ReviewTarget,
} from '@/lib/reviews/picker';

/**
 * #12 マイページの「自分の口コミ」(one-more-time #162)。
 *
 * 理由 (`reason_code` / `reason_note`) と本人の訪問日は anon / authenticated に GRANT していない列なので、
 * サーバーが service role で読み、会員の profiles.id で絞って本人にだけ返す。論理削除した口コミは出さない。
 *
 * service role は RLS を通らないので、公開している (verified) 開催の口コミだけに自分で絞る
 * (公開をやめた開催の口コミは、開くことも削除もできないため)。開催の状態は `occurrence_view` の判定を使う。
 */
const OwnReviewListRowSchema = z.object({
  id: z.number(),
  status: z.enum(REVIEW_STATUSES),
  rating: z.number().int().min(1).max(5).nullable(),
  visited_on: z.string().nullable(),
  helpful_count: z.number().int(),
  // 知らない値 (後で足す通報の理由など) で一覧ごと出せなくならないよう、読めなければ null
  reason_code: z.enum(REVIEW_REASON_CODES).nullable().catch(null),
  reason_note: z.string().nullable(),
  updated_at: z.string(),
  // 写真ごとの非公開 (one-more-time #164)。本人にだけ、その写真と理由を見せる
  review_images: z
    .array(
      z.object({
        id: z.number(),
        object_key: z.string(),
        variant_widths: z.array(z.number()),
        sort_order: z.number(),
        hidden_reason_code: z.enum(REVIEW_SCREENING_REASONS).nullable().catch(null),
      })
    )
    .default([]),
  // 開催は 7-0 の行と同じ列で読む (picker.ts)
  occurrence: ReviewTargetRowSchema,
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
  /** 審査で非公開になった写真 (公開中の口コミだけ。本人が見る短時間の URL と理由) */
  hiddenPhotos: OwnHiddenPhoto[];
  /** 開催 (名前・会場・URL・状態)。canWrite は「この口コミを直せるか」(中止になった開催の下書きなどは false) */
  target: ReviewTarget;
  /** 削除の action に渡す開催の道筋 (URL の種別・企画 ID・開催の slug) */
  route: ReviewRouteParams;
};

export type OwnHiddenPhoto = {
  id: number;
  /** サムネイル (一番小さい段の WebP。保管側の短時間だけ有効な URL) */
  src: string;
  reasonCode: ReviewScreeningReason;
};

const SELECT =
  'id, status, rating, visited_on, helpful_count, reason_code, reason_note, updated_at, ' +
  'review_images(id, object_key, variant_widths, sort_order, hidden_reason_code), ' +
  `occurrence:occurrence_view!occurrence_id!inner(${REVIEW_TARGET_COLUMNS}, verified)`;

/** 会員の口コミを、新しく書き換えた順に返す */
export async function listOwnReviews(
  db: SupabaseClient,
  profileId: string,
  /** 非公開の写真のサムネイルの URL を作る置き場所 (無ければ非公開の写真は出さない) */
  storage: ReviewPhotoStorage | null = null
): Promise<OwnReviewListItem[]> {
  const { data, error } = await db
    .from('reviews')
    .select(SELECT)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .eq('occurrence.verified', true)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    // 写真は非公開になった物だけを、並びの順に読む
    .not('review_images.hidden_reason_code', 'is', null)
    .order('sort_order', { referencedTable: 'review_images', ascending: true })
    .order('id', { referencedTable: 'review_images', ascending: true });
  if (error) throw error;
  // 直せるかは今日 (JST) に依るので、行の読み取りとは分けて 1 回だけ日付を取る
  const today = todayInJst();
  const items: OwnReviewListItem[] = [];
  for (const raw of data ?? []) {
    // 1 件が読めなくても一覧ごと出せなくしない (ほかの口コミの削除・編集はできるように)。読めない行は Sentry へ
    const parsed = OwnReviewListRowSchema.safeParse(raw);
    if (!parsed.success) {
      Sentry.captureException(parsed.error, { tags: { page: 'mypage', part: 'own-reviews' } });
      continue;
    }
    const row = parsed.data;
    items.push({
      id: row.id,
      status: row.status,
      rating: row.rating,
      visitedOn: row.visited_on,
      helpfulCount: row.helpful_count,
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      updatedAt: row.updated_at,
      hiddenPhotos:
        row.status === 'published' && storage
          ? await hiddenPhotosOf(row.review_images, storage)
          : [],
      target: toTarget(row.occurrence, today, { status: row.status, visitedOn: row.visited_on }),
      route: {
        eventType: row.occurrence.events.primaryCategory.slug,
        eventId: String(row.occurrence.events.id),
        occurrenceSlug: row.occurrence.slug,
      },
    });
  }
  return items;
}

/** 非公開になった写真を、並びの順 (読み出しで並べた順) に本人が見る URL つきで返す */
async function hiddenPhotosOf(
  images: z.infer<typeof OwnReviewListRowSchema>['review_images'],
  storage: ReviewPhotoStorage
): Promise<OwnHiddenPhoto[]> {
  return Promise.all(
    images.flatMap(image => {
      const reasonCode = image.hidden_reason_code;
      if (!reasonCode) return [];
      const key = storedVariantKey(
        image.object_key,
        variantWidthAtMost(image.variant_widths, 0),
        'webp'
      );
      return [storage.presignStoredRead(key).then(src => ({ id: image.id, src, reasonCode }))];
    })
  );
}
