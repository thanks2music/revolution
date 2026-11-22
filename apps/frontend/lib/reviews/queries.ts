import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
} from '@revolution/schemas/review';

import { StatRowSchema, toReviewStats, type ReviewStats } from '@/lib/reviews/stats';
import { createPublicClient, hasPublicSupabaseCredentials } from '@/lib/supabase/public';

/**
 * 開催のページに出す口コミ (one-more-time #161 の PR④)。
 *
 * cookie を触らない公開のクライアントで読み、開催のページの SSG / ISR を保つ。RLS で、公開中かつ
 * 論理削除していない口コミだけが見える。他人の訪問日は年月 (`visited_month`) だけ (日付の列は
 * anon・authenticated に GRANT していない)。投稿者は、公開中の口コミがある会員の表示名だけが見える。
 * 星の平均と件数は、開催の集計の列 (口コミのトリガが保つ) から出す。
 */

/** 新着から何件を出すか。すべての一覧のページは後のチケット */
export const LATEST_REVIEWS_LIMIT = 10;

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
});

/** 画面に出す形へ。訪問は年月 (YYYY-MM) だけ、退会した会員・見えない会員の名前は null */
export const PublicReviewSchema = ReviewRowSchema.transform(row => {
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
  };
});

export type PublicReview = z.output<typeof PublicReviewSchema>;

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
    };
  }
  const supabase = createPublicClient();

  const listReviews = (order: 'submitted_at' | 'helpful_count') => {
    const query = supabase
      .from('reviews')
      // 投稿者は列の名前で結び付ける (reviews と profiles には review_helpful 経由の結び付きもあり、
      // 指定しないと PostgREST が選べない)
      .select(
        'id, rating, body, visited_month, attendance, food_cost_band, goods_cost_band, has_spoiler, edited_at, helpful_count, profiles!user_id(display_name, username, withdrawn_at)'
      )
      .eq('occurrence_id', occurrenceId)
      .eq('status', 'published')
      .is('deleted_at', null)
      .order(order, { ascending: false });
    // 参考になった数が同じなら新しい順。同じ時刻の口コミが作り直しのたびに入れ替わらないよう、ID でも並べる
    return (order === 'helpful_count' ? query.order('submitted_at', { ascending: false }) : query)
      .order('id', { ascending: false })
      .limit(LATEST_REVIEWS_LIMIT);
  };

  const [rating, latest, mostHelpful, stats] = await Promise.all([
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
  ]);
  if (rating.error) throw new Error(`failed to load ratings: ${rating.error.message}`);
  for (const result of [latest, mostHelpful]) {
    if (result.error) throw new Error(`failed to load reviews: ${result.error.message}`);
  }
  // 集計が読めなくても、評価と口コミの一覧は出す (分布と行った人のデータだけを出さない)
  const statRows = stats.error ? reportStatsFailure(stats.error) : (stats.data ?? []);

  const ratingCount = Number(rating.data?.rating_count ?? 0);
  return {
    ratingAverage: averageRating(Number(rating.data?.rating_sum ?? 0), ratingCount),
    ratingCount,
    latest: z.array(PublicReviewSchema).parse(latest.data ?? []),
    mostHelpful: z.array(PublicReviewSchema).parse(mostHelpful.data ?? []),
    stats: toReviewStats(z.array(StatRowSchema).parse(statRows)),
  };
}

function reportStatsFailure(error: { message: string }): [] {
  Sentry.captureException(new Error(`failed to load review stats: ${error.message}`), {
    tags: { query: 'occurrence_review_stats' },
  });
  return [];
}
