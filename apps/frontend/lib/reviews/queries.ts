import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
} from '@revolution/schemas/review';

import { env } from '@/lib/env';
import {
  PublicPhotoRowSchema,
  publicMediaBaseUrl,
  toPublicPhoto,
  type PublicReviewPhoto,
} from '@/lib/reviews/photos/public';
import { StatRowSchema, toReviewStats, type ReviewStats } from '@/lib/reviews/stats';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 開催のページに出す口コミ (one-more-time #161 の PR④)。
 *
 * cookie を触らない公開のクライアントで読み、開催のページの SSG / ISR を保つ。RLS で、公開中かつ
 * 論理削除していない口コミだけが見える。他人の訪問日は年月 (`visited_month`) だけ (日付の列は
 * anon・authenticated に GRANT していない)。投稿者は、公開中の口コミがある会員の表示名だけが見える。
 * 星の平均と件数は、開催の集計の列 (口コミのトリガが保つ) から出す。
 *
 * 写真 (one-more-time #164): RLS で、公開中の口コミの非公開でない写真だけが見える (配信側に写っている
 * 物と同じ)。配信側の基点 (`REVIEW_PUBLIC_MEDIA_BASE_URL`) が無い環境では写真を出さない。
 */

/** 新着から何件を出すか。すべての一覧のページは後のチケット */
export const LATEST_REVIEWS_LIMIT = 10;

/** ギャラリーに並べる写真の数 (Figma #3。これより多ければ最後のマスに残りの枚数を出す) */
export const GALLERY_PHOTOS_LIMIT = 4;

const ReviewRowSchema = z.object({
  id: z.number(),
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  visited_month: z.string().nullable(),
  attendance: z.enum(REVIEW_ATTENDANCES).nullable(),
  food_cost_band: z.enum(REVIEW_FOOD_COST_BANDS).nullable(),
  goods_cost_band: z.enum(REVIEW_GOODS_COST_BANDS).nullable(),
  has_spoiler: z.boolean(),
  edited_at: z.string().nullable(),
  helpful_count: z.number().int().min(0),
  profiles: z
    .object({
      display_name: z.string().nullable(),
      username: z.string().nullable(),
      withdrawn_at: z.string().nullable(),
    })
    .nullable(),
  review_images: z.array(PublicPhotoRowSchema).default([]),
});

/**
 * 画面に出す形へ。訪問は年月 (YYYY-MM) だけ、退会した会員・見えない会員の名前は null。
 * 写真は配信側の URL にする (基点が無ければ出さない)
 */
export const publicReviewSchema = (mediaBaseUrl: string | null) =>
  ReviewRowSchema.transform(row => {
    const author = row.profiles;
    return {
      id: row.id,
      rating: row.rating,
      body: row.body,
      visitedMonth: row.visited_month?.slice(0, 7) ?? null,
      attendance: row.attendance,
      foodCostBand: row.food_cost_band,
      goodsCostBand: row.goods_cost_band,
      hasSpoiler: row.has_spoiler,
      editedAt: row.edited_at,
      helpfulCount: row.helpful_count,
      authorName:
        author && !author.withdrawn_at ? (author.display_name ?? author.username ?? null) : null,
      photos: mediaBaseUrl
        ? row.review_images.map(photo => toPublicPhoto(mediaBaseUrl, photo))
        : [],
    };
  });

export type PublicReview = z.output<ReturnType<typeof publicReviewSchema>>;

/** ギャラリー (ネタバレの口コミと非公開の写真は出さない)。`total` は出せる写真の総数 */
export type ReviewGallery = { photos: PublicReviewPhoto[]; total: number };

const EMPTY_GALLERY: ReviewGallery = { photos: [], total: 0 };

/** 星の平均 (小数 1 桁に丸める)。0 件なら null */
export function averageRating(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

export type OccurrenceReviews = {
  /** 公開中の口コミの星の平均 (小数 1 桁)。0 件なら null */
  ratingAverage: number | null;
  ratingCount: number;
  /** 新着 (LATEST_REVIEWS_LIMIT 件) */
  latest: PublicReview[];
  /** 参考になった順 (LATEST_REVIEWS_LIMIT 件)。並び替えはブラウザで切り替える (ページは ISR のまま) */
  mostHelpful: PublicReview[];
  /** 星の分布・参加のしかた・費用の帯の件数 (公開中の口コミだけ) */
  stats: ReviewStats;
  /** 写真のギャラリー (新しい順) */
  gallery: ReviewGallery;
};

export async function getOccurrenceReviews(occurrenceId: number): Promise<OccurrenceReviews> {
  // 資格情報の無いビルド (CI の Build Apps) では 0 件として描く (開催の取得と同じ扱い)
  if (!hasPublicSupabaseCredentials()) {
    return {
      ratingAverage: null,
      ratingCount: 0,
      latest: [],
      mostHelpful: [],
      stats: toReviewStats([]),
      gallery: EMPTY_GALLERY,
    };
  }
  const supabase = createPublicClient();
  const mediaBaseUrl = publicMediaBaseUrl(env.REVIEW_PUBLIC_MEDIA_BASE_URL);

  const listReviews = (order: 'submitted_at' | 'helpful_count') => {
    const query = supabase
      .from('reviews')
      // 投稿者は列の名前で結び付ける (reviews と profiles には review_helpful 経由の結び付きもあり、
      // 指定しないと PostgREST が選べない)
      .select(
        'id, rating, body, visited_month, attendance, food_cost_band, goods_cost_band, has_spoiler, edited_at, helpful_count, profiles!user_id(display_name, username, withdrawn_at), review_images(id, object_key, width, height, variant_widths)'
      )
      .eq('occurrence_id', occurrenceId)
      .eq('status', 'published')
      .is('deleted_at', null)
      .order('sort_order', { referencedTable: 'review_images', ascending: true })
      .order('id', { referencedTable: 'review_images', ascending: true })
      .order(order, { ascending: false });
    // 参考になった数が同じなら新しい順。同じ時刻の口コミが作り直しのたびに入れ替わらないよう、ID でも並べる
    return (order === 'helpful_count' ? query.order('submitted_at', { ascending: false }) : query)
      .order('id', { ascending: false })
      .limit(LATEST_REVIEWS_LIMIT);
  };

  // ギャラリー: ネタバレでない公開中の口コミの写真 (非公開の写真は RLS で見えない)。新しい写真から
  const listGallery = () =>
    supabase
      .from('review_images')
      .select(
        'id, object_key, width, height, variant_widths, reviews!inner(occurrence_id, has_spoiler)',
        {
          count: 'exact',
        }
      )
      .eq('reviews.occurrence_id', occurrenceId)
      .eq('reviews.has_spoiler', false)
      .order('id', { ascending: false })
      .limit(GALLERY_PHOTOS_LIMIT);

  const [rating, latest, mostHelpful, stats, gallery] = await Promise.all([
    supabase
      .from('occurrence_view')
      .select('rating_sum, rating_count')
      .eq('id', occurrenceId)
      .maybeSingle(),
    listReviews('submitted_at'),
    listReviews('helpful_count'),
    supabase
      .from('occurrence_review_stats')
      .select('dimension, value, count')
      .eq('occurrence_id', occurrenceId),
    mediaBaseUrl ? listGallery() : null,
  ]);
  if (rating.error) throw new Error(`failed to load ratings: ${rating.error.message}`);
  for (const result of [latest, mostHelpful]) {
    if (result.error) throw new Error(`failed to load reviews: ${result.error.message}`);
  }
  // 集計が読めなくても、評価と口コミの一覧は出す (分布と行った人のデータだけを出さない)
  const statRows = stats.error ? reportStatsFailure(stats.error) : parseStatRows(stats.data ?? []);
  const schema = z.array(publicReviewSchema(mediaBaseUrl));

  const ratingCount = Number(rating.data?.rating_count ?? 0);
  return {
    ratingAverage: averageRating(Number(rating.data?.rating_sum ?? 0), ratingCount),
    ratingCount,
    latest: schema.parse(latest.data ?? []),
    mostHelpful: schema.parse(mostHelpful.data ?? []),
    stats: toReviewStats(statRows),
    gallery: mediaBaseUrl && gallery ? toGallery(mediaBaseUrl, gallery) : EMPTY_GALLERY,
  };
}

/** ギャラリーが読めなくても、口コミの一覧は出す (ギャラリーだけを出さない) */
function toGallery(
  mediaBaseUrl: string,
  result: { data: unknown[] | null; count: number | null; error: { message: string } | null }
): ReviewGallery {
  if (result.error) {
    Sentry.captureException(new Error(`failed to load review gallery: ${result.error.message}`), {
      tags: { query: 'review_gallery' },
    });
    return EMPTY_GALLERY;
  }
  const photos = z
    .array(PublicPhotoRowSchema)
    .parse(result.data ?? [])
    .map(row => toPublicPhoto(mediaBaseUrl, row));
  return { photos, total: Math.max(result.count ?? 0, photos.length) };
}

function reportStatsFailure(error: { message: string }): [] {
  Sentry.captureException(new Error(`failed to load review stats: ${error.message}`), {
    tags: { query: 'occurrence_review_stats' },
  });
  return [];
}

/** 集計の行を読む。形の合わない行があっても欄ごと落とさず、読めた行だけで出す (読めない行は Sentry へ) */
function parseStatRows(rows: unknown[]) {
  const parsed = rows.map(row => StatRowSchema.safeParse(row));
  const failed = parsed.filter(result => !result.success);
  if (failed.length > 0) {
    Sentry.captureException(failed[0].error, { tags: { query: 'occurrence_review_stats' } });
  }
  return parsed.flatMap(result => (result.success ? [result.data] : []));
}
