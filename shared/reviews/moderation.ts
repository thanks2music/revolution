import 'server-only';

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  REVIEW_MODERATION_ACTIONS,
  REVIEW_MODERATION_ACTORS,
  REVIEW_REASON_CODES,
  REVIEW_REPORT_REASONS,
  REVIEW_SCREENING_REASONS,
  REVIEW_STATUSES,
  type ReviewReportReason,
  type ReviewScreeningReason,
} from '@revolution/schemas/review';

import { screenSubmittedReview, type ScreenReviewOutcome } from './operations';
import { syncPhotoDeliverySafely } from './photos/delivery';
import { toStoredPhotoView } from './photos/operations';
import { PublicPhotoRowSchema } from './photos/public';
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

type Failure = { kind: 'forbidden' };

/** admin の関数が admin でない時に投げる物 (migration 0026)。ほかの 42501 (GRANT の抜けなど) は不具合として投げ直す */
function isForbidden(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42501' && error.message === 'admin only';
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
  // migration 0027 で足した列。0027 の前の DB (アプリの deploy が migration より先に終わった時) でも
  // 一覧が壊れないよう、無ければ提出の時刻を使う
  pending_since: z.string().optional(),
});

export type ReviewQueueItem = {
  reviewId: number;
  /** AI が迷った / AI の審査に失敗した (BOSS の確認待ち) / 審査中のまま止まっている */
  kind: 'unsure' | 'ai_failure' | 'stuck';
  aiReason: string | null;
  /** AI の審査に失敗した時の内容 (審査器の内部の文) */
  aiError: string | null;
  submittedAt: string;
  /** 審査中になった時刻 (提出か、最後の「もう一度 AI にかける」の遅い方)。止まっている時間はここから数える */
  pendingSince: string;
  rating: number;
  eventName: string;
  venueName: string | null;
  authorName: string | null;
  photoCount: number;
};

function queueKind(row: z.infer<typeof QueueRowSchema>): ReviewQueueItem['kind'] {
  if (row.status === 'pending') return 'stuck';
  return row.reason_code === 'ai_failure' ? 'ai_failure' : 'unsure';
}

export async function listReviewQueue(
  adminDb: SupabaseClient,
  /** 「止まっている」とみなす分数。省くと DB の既定 (private.review_stuck_minutes、30 分) */
  options: { stuckMinutes?: number } = {}
): Promise<{ kind: 'ok'; items: ReviewQueueItem[] } | Failure> {
  // 分数を省いた時は引数ごと送らない (DB の関数の既定を使う。0027 の前の DB でも同じ既定の 30 分になる)
  const { data, error } = await adminDb.rpc(
    'admin_list_review_queue',
    options.stuckMinutes === undefined ? {} : { p_stuck_minutes: options.stuckMinutes }
  );
  if (isForbidden(error)) return { kind: 'forbidden' };
  if (error) throw error;
  const items = z
    .array(QueueRowSchema)
    .parse(data ?? [])
    .map(row => ({
      reviewId: row.review_id,
      kind: queueKind(row),
      aiReason: row.ai_reason,
      aiError: row.ai_error,
      submittedAt: row.submitted_at,
      pendingSince: row.pending_since ?? row.submitted_at,
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
  // migration 0027 で足した値。0027 の前の DB では無いので、審査中なら止まっている扱いにする (0026 の挙動)
  pending_since: z.string().nullable().optional(),
  stuck: z.boolean().optional(),
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
    PublicPhotoRowSchema.extend({
      sort_order: z.number(),
      hidden_reason_code: z.enum(REVIEW_REPORT_REASONS).nullable(),
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
      ai_reason: z.string().nullable(),
      ai_error: z.string().nullable(),
      created_at: z.string(),
    })
  ),
});

export type ModerationPhoto = {
  id: number;
  /** 非公開の理由 (非公開でなければ null) */
  hiddenReason: ReviewReportReason | null;
  /** 保管側の短時間だけ有効な URL。置き場所の無い環境では null (それでも判断はできる) */
  view: ReviewPhotoView | null;
};

type Detail = z.infer<typeof DetailSchema>;

export type ModerationReview = {
  review: Detail['review'];
  /** 審査中のまま「止まっている」か (一覧・もう一度 AI にかける条件と同じ DB の判定) */
  stuck: boolean;
  /** 審査中になった時刻 (提出か、最後の「もう一度 AI にかける」の遅い方) */
  pendingSince: string | null;
  event: Detail['event'];
  occurrence: Detail['occurrence'];
  authorName: string | null;
  /** 並び順。非公開の写真も含む (保管側の短時間だけ有効な URL) */
  photos: ModerationPhoto[];
  /** 判断の記録 (古い順) */
  history: Detail['events'];
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
  // 置き場所が無い環境でも写真の ID と印は返す (判断の時に写真の集まりを DB と合わせるため)
  const photos = await Promise.all(
    detail.photos.map(async photo => ({
      id: photo.id,
      hiddenReason: photo.hidden_reason_code,
      view: storage ? await toStoredPhotoView(storage, photo) : null,
    }))
  );
  return {
    kind: 'ok',
    review: {
      review: detail.review,
      stuck: detail.stuck ?? detail.review.status === 'pending',
      pendingSince: detail.pending_since ?? detail.review.submitted_at,
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

/** 写真ごとの判断。非公開にする写真には理由が要る */
export type PhotoDecision =
  { id: number; hide: false } | { id: number; hide: true; reason: ReviewScreeningReason };

export type ReviewDecision =
  | { decision: 'publish' }
  | { decision: 'reject'; reasonCode: ReviewScreeningReason; reasonNote: string | null };

/**
 * 公開か差し戻し。`photos` は読んだ写真の全部の判断 (非公開にする写真には理由)。読んだ時の `submittedAt` と
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
 * 戻せた時は、審査の結果 (`screening`) も返す。審査が例外で止まった時は `error` (口コミは審査中のまま。
 * 30 分たつと確認待ちの一覧に「止まっている」として出る)
 */
export async function requeueReview(
  deps: ModerationDeps & {
    screener: ReviewScreener;
    /**
     * 審査を応答の後に回す時に渡す (Next の `after()` など)。渡すと審査を待たずに `scheduled` を返す。
     * 審査の結果は数分で出る (管理アプリの「もう一度 AI にかける」、Figma 13 のトースト)
     */
    schedule?: (task: () => Promise<unknown>) => void;
  },
  input: { reviewId: number; submittedAt: string }
): Promise<
  | Exclude<ModerationWriteOutcome, { kind: 'applied' }>
  | { kind: 'applied'; screening: ScreenReviewOutcome | { kind: 'error' } | { kind: 'scheduled' } }
> {
  const { data, error } = await deps.adminDb.rpc('admin_requeue_review', {
    p_review_id: input.reviewId,
    p_submitted_at: input.submittedAt,
  });
  const outcome = toWriteOutcome(data, error);
  if (outcome.kind !== 'applied') return outcome;
  const run = async (): Promise<ScreenReviewOutcome | { kind: 'error' }> => {
    try {
      return await screenSubmittedReview(input.reviewId, {
        screener: deps.screener,
        db: deps.serviceDb,
        storage: deps.storage,
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { part: 'review-moderation', step: 'requeue' } });
      return { kind: 'error' };
    }
  };
  if (deps.schedule) {
    deps.schedule(run);
    return { kind: 'applied', screening: { kind: 'scheduled' } };
  }
  return { kind: 'applied', screening: await run() };
}

function toWriteOutcome(
  data: unknown,
  error: { code?: string; message?: string } | null
): ModerationWriteOutcome {
  if (isForbidden(error)) return { kind: 'forbidden' };
  if (error) throw error;
  if (data === 'applied' || data === 'superseded' || data === 'photos_changed')
    return { kind: data };
  throw new Error(`unexpected moderation result: ${String(data)}`);
}
