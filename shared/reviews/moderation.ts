import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  REVIEW_MODERATION_ACTIONS,
  REVIEW_MODERATION_ACTORS,
  REVIEW_REASON_CODES,
  REVIEW_SCREENING_REASONS,
  REVIEW_STATUSES,
  type ReviewScreeningReason,
} from '@revolution/schemas/review';

import { screenSubmittedReview, type ScreenReviewOutcome } from './operations';
import { syncPhotoDeliverySafely } from './photos/delivery';
import { toStoredPhotoView } from './photos/operations';
import type { ReviewPhotoStorage, ReviewPhotoView } from './photos/storage';
import type { ReviewScreener } from './screener/types';

/**
 * BOSS の操作 (管理アプリ、one-more-time #167)。確認待ちの一覧・口コミの確認・公開・差し戻し・写真の非公開・
 * もう一度 AI にかける。
 *
 * - 読み書きは、BOSS のログインのクライアント (`adminDb`) で admin の DB の関数 (migration 0026) を呼ぶ。
 *   関数の中でも admin を確かめ、admin でなければ `forbidden` を返す (管理アプリの入口の確認と二段)
 * - 配信側への写し・消しと、AI の審査のやり直しは、service role のクライアント (`serviceDb`) で行う。呼ぶのは
 *   管理アプリのサーバーが admin を確かめた後だけ
 * - 結果は型付きで返す。読んだ後に投稿者が出し直した (`superseded`) / 写真が変わった (`photos_changed`)
 */

/** 確認待ちの一覧に出す、審査中のまま止まっている時間 (仕様 #156) */
export const STUCK_PENDING_MINUTES = 30;

type Failure = { kind: 'forbidden' };

const PG_INSUFFICIENT_PRIVILEGE = '42501';

function isForbidden(error: { code?: string } | null): boolean {
  return error?.code === PG_INSUFFICIENT_PRIVILEGE;
}

// ───────────────────────────────────────────────
// 確認待ちの一覧
// ───────────────────────────────────────────────

const QueueRowSchema = z.object({
  review_id: z.number(),
  status: z.enum(REVIEW_STATUSES),
  reason_code: z.enum(REVIEW_REASON_CODES).nullable(),
  ai_reason: z.string().nullable(),
  ai_error: z.string().nullable(),
  submitted_at: z.string(),
  rating: z.number().int().min(1).max(5),
  event_name: z.string(),
  venue_name: z.string().nullable(),
  author_name: z.string().nullable(),
  photo_count: z.number().int().min(0),
});

export type ReviewQueueItem = {
  reviewId: number;
  /** AI が迷った / AI の審査に失敗した (BOSS の確認待ち) / 審査中のまま止まっている */
  kind: 'unsure' | 'ai_failure' | 'stuck';
  aiReason: string | null;
  submittedAt: string;
  rating: number;
  eventName: string;
  venueName: string | null;
  authorName: string | null;
  photoCount: number;
};

export async function listReviewQueue(
  adminDb: SupabaseClient,
  options: { stuckMinutes?: number } = {}
): Promise<{ kind: 'ok'; items: ReviewQueueItem[] } | Failure> {
  const { data, error } = await adminDb.rpc('admin_list_review_queue', {
    p_stuck_minutes: options.stuckMinutes ?? STUCK_PENDING_MINUTES,
  });
  if (isForbidden(error)) return { kind: 'forbidden' };
  if (error) throw error;
  const items = z
    .array(QueueRowSchema)
    .parse(data ?? [])
    .map(row => ({
      reviewId: row.review_id,
      kind:
        row.status === 'pending'
          ? ('stuck' as const)
          : row.reason_code === 'ai_failure'
            ? ('ai_failure' as const)
            : ('unsure' as const),
      aiReason: row.ai_reason,
      submittedAt: row.submitted_at,
      rating: row.rating,
      eventName: row.event_name,
      venueName: row.venue_name,
      authorName: row.author_name,
      photoCount: row.photo_count,
    }));
  return { kind: 'ok', items };
}

// ───────────────────────────────────────────────
// 口コミの確認
// ───────────────────────────────────────────────

const DetailSchema = z.object({
  review: z.object({
    id: z.number(),
    status: z.enum(REVIEW_STATUSES),
    rating: z.number().int().min(1).max(5).nullable(),
    body: z.string().nullable(),
    visited_on: z.string().nullable(),
    attendance: z.enum(REVIEW_ATTENDANCES).nullable(),
    food_cost_band: z.enum(REVIEW_FOOD_COST_BANDS).nullable(),
    goods_cost_band: z.enum(REVIEW_GOODS_COST_BANDS).nullable(),
    has_spoiler: z.boolean(),
    submitted_at: z.string().nullable(),
    reason_code: z.enum(REVIEW_REASON_CODES).nullable(),
    reason_note: z.string().nullable(),
    ai_reason: z.string().nullable(),
    ai_error: z.string().nullable(),
    ai_model: z.string().nullable(),
  }),
  event: z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    category_slug: z.string(),
  }),
  occurrence: z.object({ id: z.number(), slug: z.string(), venue_name: z.string().nullable() }),
  author: z.object({ display_name: z.string().nullable(), username: z.string().nullable() }),
  photos: z.array(
    z.object({
      id: z.number(),
      object_key: z.string(),
      width: z.number(),
      height: z.number(),
      variant_widths: z.array(z.number()),
      sort_order: z.number(),
      hidden_reason_code: z.enum(REVIEW_SCREENING_REASONS).nullable(),
    })
  ),
  events: z.array(
    z.object({
      id: z.number(),
      actor: z.enum(REVIEW_MODERATION_ACTORS),
      action: z.enum(REVIEW_MODERATION_ACTIONS),
      from_status: z.string().nullable(),
      to_status: z.string(),
      reason_code: z.string().nullable(),
      reason_note: z.string().nullable(),
      ai_model: z.string().nullable(),
      created_at: z.string(),
    })
  ),
});

export type ModerationPhoto = ReviewPhotoView & {
  /** 非公開の理由 (非公開でなければ null) */
  hiddenReason: ReviewScreeningReason | null;
};

export type ModerationReview = {
  review: z.infer<typeof DetailSchema>['review'];
  event: z.infer<typeof DetailSchema>['event'];
  occurrence: z.infer<typeof DetailSchema>['occurrence'];
  authorName: string | null;
  /** 並び順。非公開の写真も含む (保管側の短時間だけ有効な URL) */
  photos: ModerationPhoto[];
  /** 判断の記録 (古い順) */
  history: z.infer<typeof DetailSchema>['events'];
};

export async function getReviewForModeration(
  adminDb: SupabaseClient,
  storage: ReviewPhotoStorage | null,
  reviewId: number
): Promise<{ kind: 'ok'; review: ModerationReview } | { kind: 'not_found' } | Failure> {
  const { data, error } = await adminDb.rpc('admin_get_review', { p_review_id: reviewId });
  if (isForbidden(error)) return { kind: 'forbidden' };
  if (error) throw error;
  if (data === null) return { kind: 'not_found' };
  const detail = DetailSchema.parse(data);
  // 置き場所が無い環境 (写真の機能を使わない設定) では写真を出さない
  const photos = storage
    ? await Promise.all(
        detail.photos.map(async photo => ({
          ...(await toStoredPhotoView(storage, photo)),
          hiddenReason: photo.hidden_reason_code,
        }))
      )
    : [];
  return {
    kind: 'ok',
    review: {
      review: detail.review,
      event: detail.event,
      occurrence: detail.occurrence,
      authorName: detail.author.display_name ?? detail.author.username,
      photos,
      history: detail.events,
    },
  };
}

// ───────────────────────────────────────────────
// 公開・差し戻し・もう一度 AI にかける
// ───────────────────────────────────────────────

export type ModerationDeps = {
  /** BOSS のログインのクライアント (admin の DB の関数を呼ぶ) */
  adminDb: SupabaseClient;
  /** service role のクライアント (配信側の同期と審査のやり直し。admin を確かめた後だけ使う) */
  serviceDb: SupabaseClient;
  storage: ReviewPhotoStorage | null;
};

export type ModerationWriteOutcome =
  | { kind: 'applied' }
  /** 読んだ後に投稿者が出し直した・削除した・ほかの操作で状態が変わった */
  | { kind: 'superseded' }
  /** 読んだ後に写真が足された・外された (見ていない写真を公開しない) */
  | { kind: 'photos_changed' }
  | Failure;

export type PhotoDecision = { id: number; hide: boolean; reason: ReviewScreeningReason | null };

export type ReviewDecision =
  | { decision: 'publish' }
  | { decision: 'reject'; reasonCode: ReviewScreeningReason; reasonNote: string | null };

/**
 * 公開か差し戻し。`photos` は口コミの全部の写真の判断 (非公開にする写真には理由)。読んだ時の `submittedAt` と
 * 写真の集まりが今と違えば書かない。書けたら配信側を合わせる (公開なら非公開でない写真を写し、差し戻しなら消す)
 */
export async function decideReview(
  deps: ModerationDeps,
  input: { reviewId: number; submittedAt: string; photos: PhotoDecision[] } & ReviewDecision
): Promise<ModerationWriteOutcome> {
  const { data, error } = await deps.adminDb.rpc('admin_decide_review', {
    p_review_id: input.reviewId,
    p_submitted_at: input.submittedAt,
    p_decision: input.decision,
    p_reason_code: input.decision === 'reject' ? input.reasonCode : null,
    p_reason_note: input.decision === 'reject' ? input.reasonNote : null,
    p_photo_ids: input.photos.map(photo => photo.id),
    p_photo_marks: input.photos.map(photo => ({
      id: photo.id,
      hide: photo.hide,
      reason: photo.hide ? photo.reason : null,
    })),
  });
  const outcome = toWriteOutcome(data, error);
  if (outcome.kind === 'applied' && deps.storage) {
    await syncPhotoDeliverySafely({ db: deps.serviceDb, storage: deps.storage }, input.reviewId);
  }
  return outcome;
}

/**
 * もう一度 AI にかける。審査中に戻してから、同じ審査の流れ (`screenSubmittedReview`) を走らせる。
 * 戻せた時は、審査の結果 (`screening`) も返す
 */
export async function requeueReview(
  deps: ModerationDeps & { screener: ReviewScreener },
  input: { reviewId: number; submittedAt: string }
): Promise<ModerationWriteOutcome | { kind: 'applied'; screening: ScreenReviewOutcome }> {
  const { data, error } = await deps.adminDb.rpc('admin_requeue_review', {
    p_review_id: input.reviewId,
    p_submitted_at: input.submittedAt,
  });
  const outcome = toWriteOutcome(data, error);
  if (outcome.kind !== 'applied') return outcome;
  const screening = await screenSubmittedReview(input.reviewId, {
    screener: deps.screener,
    db: deps.serviceDb,
    storage: deps.storage,
  });
  return { kind: 'applied', screening };
}

function toWriteOutcome(data: unknown, error: { code?: string } | null): ModerationWriteOutcome {
  if (isForbidden(error)) return { kind: 'forbidden' };
  if (error) throw error;
  if (data === 'applied' || data === 'superseded' || data === 'photos_changed')
    return { kind: data };
  throw new Error(`unexpected moderation result: ${String(data)}`);
}
