import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReviewReasonCode, ReviewStatus } from '@revolution/schemas/review';

import { syncPhotoDelivery } from './photos/delivery';
import { storedVariantKey, type ReviewPhotoStorage } from './photos/storage';
import type {
  ReviewPhotoScreening,
  ReviewScreener,
  ReviewScreeningPhoto,
  ReviewScreeningResult,
} from './screener/types';

/**
 * 口コミの操作の層 (仕様: 審査・管理・通報の 3 つの入口が同じ関数を通る)。
 *
 * ここでは「提出された口コミを審査して、結果を書く」を持つ。書き込みは service role のクライアントで行う
 * (投稿者は状態・理由・AI の記録を書けない。列単位の GRANT とトリガで止めている)。
 *
 * - 読んだ時点の `submitted_at` と状態 (審査中) を条件にして書く (compare-and-set)。審査の間に投稿者が
 *   内容を変えて提出し直すと `submitted_at` が変わり、古い本文の審査結果で上書きしない
 * - 審査中でない口コミには何もしない (二重の実行や、管理画面で先に判断された物)
 * - 審査器は例外を投げない。失敗は「AI 審査の失敗」として BOSS の確認待ちに回す
 * - 写真 (one-more-time #164): 本文と一緒に写真も審査する。1 枚だけ問題なら、その写真だけを非公開にして
 *   口コミは公開する。迷った写真があれば、口コミごと BOSS の確認待ちにする。書いた後に配信側を合わせる
 */

export type ScreenReviewOutcome =
  /** 審査の結果を書いた */
  | {
      kind: 'screened';
      status: Extract<ReviewStatus, 'published' | 'rejected' | 'needs_review'>;
      occurrenceId: number;
    }
  /** 審査中でない・見つからない・審査の間に提出し直された (何も書いていない) */
  | { kind: 'skipped'; reason: 'not_found' | 'not_pending' | 'superseded' };

type ScreeningWrite = {
  status: Extract<ReviewStatus, 'published' | 'rejected' | 'needs_review'>;
  reason_code: ReviewReasonCode | null;
  ai_reason: string | null;
  ai_error: string | null;
  ai_model: string | null;
};

/** 審査器の結果を、口コミに書く値にする */
export function toScreeningWrite(result: ReviewScreeningResult): ScreeningWrite {
  // 迷った写真があれば、本文が通っても公開しない (写真の判断を BOSS に回す)
  if (result.ok && result.decision === 'publish') {
    const unsure = result.photos.flatMap((photo, i) =>
      photo.decision === 'unsure' ? [i + 1] : []
    );
    if (unsure.length > 0) {
      return {
        status: 'needs_review',
        reason_code: null,
        ai_reason: `${result.reason} (写真 ${unsure.join('・')} は判断に迷った)`,
        ai_error: null,
        ai_model: result.model,
      };
    }
  }
  if (!result.ok) {
    return {
      status: 'needs_review',
      reason_code: 'ai_failure',
      ai_reason: null,
      ai_error: result.error,
      ai_model: result.model,
    };
  }
  const common = { ai_reason: result.reason, ai_error: null, ai_model: result.model };
  switch (result.decision) {
    case 'publish':
      return { status: 'published', reason_code: null, ...common };
    case 'reject':
      return { status: 'rejected', reason_code: result.reasonCode, ...common };
    case 'unsure':
      return { status: 'needs_review', reason_code: null, ...common };
  }
}

/** 審査に渡す写真の幅 (作った段のうち、これ以下で一番大きい物。無ければ一番小さい物) */
const SCREENING_PHOTO_WIDTH = 720;

type PhotoRow = { id: number; object_key: string; variant_widths: number[] };

function screeningVariantKey(row: PhotoRow): string {
  const widths = [...row.variant_widths].sort((a, b) => a - b);
  const width = widths.filter(w => w <= SCREENING_PHOTO_WIDTH).pop() ?? widths[0];
  return storedVariantKey(row.object_key, width, 'webp');
}

/** 審査に渡す写真を読む。置き場所が無い・読めない写真があれば null (審査を失敗として扱う) */
async function readScreeningPhotos(
  rows: PhotoRow[],
  storage: ReviewPhotoStorage | null
): Promise<ReviewScreeningPhoto[] | null> {
  if (rows.length === 0) return [];
  if (!storage) return null;
  const bodies = await Promise.all(rows.map(row => storage.readStored(screeningVariantKey(row))));
  if (bodies.some(body => body === null)) return null;
  return bodies.map(data => ({ data: data as Uint8Array, mimeType: 'image/webp' }));
}

/** 写真ごとの非公開の印 (hide の写真に理由、それ以外は印を外す)。状態と一緒に 1 つのトランザクションで書く */
function photoMarks(rows: PhotoRow[], photos: ReviewPhotoScreening[]) {
  return rows.map((row, i) => {
    const hide = photos[i]?.decision === 'hide';
    return { id: row.id, hide, reason: hide ? photos[i].reasonCode : null };
  });
}

export async function screenSubmittedReview(
  reviewId: number,
  deps: {
    screener: ReviewScreener;
    db: SupabaseClient;
    /** 写真の置き場所 (写真を審査に渡し、配信側を合わせる)。無ければ写真のある口コミは審査の失敗 */
    storage?: ReviewPhotoStorage | null;
    now?: () => Date;
  }
): Promise<ScreenReviewOutcome> {
  const { data: review, error: readError } = await deps.db
    .from('reviews')
    .select('id, status, body, submitted_at, occurrence_id, deleted_at')
    .eq('id', reviewId)
    .maybeSingle();
  if (readError) throw readError;
  if (!review || review.deleted_at) return { kind: 'skipped', reason: 'not_found' };
  if (review.status !== 'pending') return { kind: 'skipped', reason: 'not_pending' };

  const { data: photoRows, error: photoError } = await deps.db
    .from('review_images')
    .select('id, object_key, variant_widths')
    .eq('review_id', reviewId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (photoError) throw photoError;
  const rows = (photoRows ?? []) as PhotoRow[];
  const photos = await readScreeningPhotos(rows, deps.storage ?? null);

  const result: ReviewScreeningResult = photos
    ? await deps.screener.screen({ body: review.body, photos })
    : { ok: false, error: 'review photos could not be read', model: null };
  const write = toScreeningWrite(result);
  const screenedAt = (deps.now?.() ?? new Date()).toISOString();
  // 状態と写真の印は、読んだ時の submitted_at と「審査中」を条件に、1 つのトランザクションで書く
  // (migration 0023 の apply_review_screening)。審査の間に出し直されていれば何も書かない。
  // 印は公開になる時だけ書く (公開にならない口コミの写真は誰にも見えないので、前の印のままでよい)
  const { data: applied, error: writeError } = await deps.db.rpc('apply_review_screening', {
    p_review_id: reviewId,
    p_submitted_at: review.submitted_at,
    p_status: write.status,
    p_reason_code: write.reason_code,
    p_ai_reason: write.ai_reason,
    p_ai_error: write.ai_error,
    p_ai_model: write.ai_model,
    p_screened_at: screenedAt,
    p_photo_marks:
      result.ok && write.status === 'published' ? photoMarks(rows, result.photos) : null,
  });
  if (writeError) throw writeError;
  if (applied !== true) return { kind: 'skipped', reason: 'superseded' };

  // 公開になった写真を配信側へ。公開にならなかった時も呼ぶ (公開中からの編集で残った物を消す)
  if (deps.storage) await syncPhotoDelivery({ db: deps.db, storage: deps.storage }, reviewId);

  return { kind: 'screened', status: write.status, occurrenceId: review.occurrence_id };
}
