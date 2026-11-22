import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  REVIEW_REASON_CODES,
  REVIEW_STATUSES,
  type ReviewAttendance,
  type ReviewFoodCostBand,
  type ReviewGoodsCostBand,
} from '@revolution/schemas/review';

/**
 * 投稿者が起こす操作のうち、状態か論理削除を書くもの (one-more-time #162)。
 *
 * 仕様 #156: 投稿者が起こせるのは「下書きの保存」「提出」「内容の変更」「削除」だけ。投稿者は状態と
 * `deleted_at` を列単位の GRANT で書けないので、下書きの保存・提出・削除はサーバー (service role) が行う。どれも
 * 本人の profiles.id と、読んだ時点の状態で絞って書く (compare-and-set)。内容の変更 (公開後の編集など)
 * は、投稿者の RLS のクライアントで書き、トリガが審査中に戻す (`actions/review.ts`)。
 */

/** 内容の列 (下書きでは星と訪問日が空でよい) */
export type ReviewContent = {
  rating: number | null;
  visitedOn: string | null;
  attendance: ReviewAttendance | null;
  foodCostBand: ReviewFoodCostBand | null;
  goodsCostBand: ReviewGoodsCostBand | null;
  body: string | null;
  hasSpoiler: boolean;
};

export function toContentColumns(content: ReviewContent) {
  return {
    rating: content.rating,
    visited_on: content.visitedOn,
    attendance: content.attendance,
    food_cost_band: content.foodCostBand,
    goods_cost_band: content.goodsCostBand,
    body: content.body,
    has_spoiler: content.hasSpoiler,
  };
}

/**
 * 本人の口コミ 1 件 (編集の初期値・本人の状態の表示・内容の変更の判定に使う)。
 * 理由と訪問日は anon・authenticated に GRANT していない列なので、service role で読む
 */
const OwnReviewSchema = z
  .object({
    id: z.number(),
    status: z.enum(REVIEW_STATUSES),
    rating: z.number().int().nullable(),
    visited_on: z.string().nullable(),
    attendance: z.enum(REVIEW_ATTENDANCES).nullable(),
    food_cost_band: z.enum(REVIEW_FOOD_COST_BANDS).nullable(),
    goods_cost_band: z.enum(REVIEW_GOODS_COST_BANDS).nullable(),
    body: z.string().nullable(),
    has_spoiler: z.boolean(),
    // 理由は本人に見せるためだけの列。知らない値 (通報の理由など、後で足すもの) で書き込みの操作まで
    // 止めないよう、読めなければ null にする
    reason_code: z.enum(REVIEW_REASON_CODES).nullable().catch(null),
    reason_note: z.string().nullable(),
    submitted_at: z.string().nullable(),
  })
  .transform(row => ({
    id: row.id,
    status: row.status,
    rating: row.rating,
    visitedOn: row.visited_on,
    attendance: row.attendance,
    foodCostBand: row.food_cost_band,
    goodsCostBand: row.goods_cost_band,
    body: row.body,
    hasSpoiler: row.has_spoiler,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    submittedAt: row.submitted_at,
  }));

export type OwnReview = z.output<typeof OwnReviewSchema>;

const OWN_REVIEW_COLUMNS =
  'id, status, rating, visited_on, attendance, food_cost_band, goods_cost_band, body, has_spoiler, ' +
  'reason_code, reason_note, submitted_at';

/** 会員のこの開催の口コミ (論理削除していないもの)。無ければ null */
export async function findOwnReview(
  db: SupabaseClient,
  profileId: string,
  occurrenceId: number
): Promise<OwnReview | null> {
  const { data, error } = await db
    .from('reviews')
    .select(OWN_REVIEW_COLUMNS)
    .eq('occurrence_id', occurrenceId)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ? OwnReviewSchema.parse(data) : null;
}

export type SaveDraftOutcome =
  | { kind: 'saved'; reviewId: number }
  /** もう提出した口コミがある (下書きには戻せない。編集は提出で行う) */
  | { kind: 'not_draft' };

/** 下書きを保存する。この開催の下書きがあれば書き換え、無ければ作る。審査には回さない */
export async function saveDraft(
  db: SupabaseClient,
  input: { profileId: string; occurrenceId: number; content: ReviewContent }
): Promise<SaveDraftOutcome> {
  const existing = await findOwnReview(db, input.profileId, input.occurrenceId);
  const columns = toContentColumns(input.content);

  if (existing) {
    if (existing.status !== 'draft') return { kind: 'not_draft' };
    const { data, error } = await db
      .from('reviews')
      .update(columns)
      .eq('id', existing.id)
      .eq('user_id', input.profileId)
      .eq('status', 'draft')
      .is('deleted_at', null)
      .select('id');
    if (error) throw error;
    // 保存の間に提出された (別の端末など)
    if (!data || data.length === 0) return { kind: 'not_draft' };
    return { kind: 'saved', reviewId: existing.id };
  }

  const { data, error } = await db
    .from('reviews')
    .insert({
      occurrence_id: input.occurrenceId,
      user_id: input.profileId,
      status: 'draft',
      ...columns,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { kind: 'saved', reviewId: data.id as number };
}

/**
 * 下書きを提出する (下書き → 審査中)。内容も同時に書く。下書きでなくなっていれば false
 * (別の端末で先に提出された)。開催と訪問日は DB のトリガも確かめる (migration 0019)
 */
export async function submitDraft(
  db: SupabaseClient,
  input: { profileId: string; reviewId: number; content: ReviewContent }
): Promise<boolean> {
  const { data, error } = await db
    .from('reviews')
    .update({
      ...toContentColumns(input.content),
      status: 'pending',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', input.reviewId)
    .eq('user_id', input.profileId)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type DeleteOutcome = { kind: 'deleted'; wasPublished: boolean } | { kind: 'not_found' };

/** 自分の口コミを論理削除する。集計からはトリガが外す。削除の後は同じ開催にもう一度書ける */
export async function deleteOwnReview(
  db: SupabaseClient,
  input: { profileId: string; occurrenceId: number; reviewId: number }
): Promise<DeleteOutcome> {
  const { data, error } = await db
    .from('reviews')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', input.reviewId)
    .eq('user_id', input.profileId)
    .eq('occurrence_id', input.occurrenceId)
    .is('deleted_at', null)
    .select('status');
  if (error) throw error;
  const row = data?.[0];
  if (!row) return { kind: 'not_found' };
  return { kind: 'deleted', wasPublished: row.status === 'published' };
}
