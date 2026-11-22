import 'server-only';

import { randomUUID } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { MAX_REVIEW_PHOTOS, type ReviewPhotoUploadRequest } from '@revolution/schemas/review-photo';

import { convertReviewPhoto, type ConvertReviewPhotoFailure } from './convert';
import {
  photoKey,
  REVIEW_PHOTO_FORMATS,
  storedVariantKey,
  variantKeys,
  type ReviewPhotoStorage,
} from './storage';

/**
 * 口コミの写真の操作 (one-more-time #163)。Server Action はこの層だけを呼ぶ。
 *
 * - db は service role のクライアント (写真の行を足すのはサーバーだけ。0021)。会員の口コミかどうかは
 *   ここで profileId と照らして確かめる。開催が書ける状態か (`authoringMode`) は呼ぶ側が確かめる
 * - 置き場所は差し替えのできる口 (`ReviewPhotoStorage`)。結合テストと E2E は偽物を使う
 * - throw せず型付きの結果を返す。置き場所・DB の障害だけを投げる (呼ぶ側が Sentry に送る)
 */
export type PhotoContext = {
  db: SupabaseClient;
  storage: ReviewPhotoStorage;
  /** キーの先頭 (`reviewPhotoKeyPrefix`) */
  prefix: string;
};

/** 本人に見せる写真 1 枚。URL は短時間だけ有効 */
export type OwnReviewPhoto = {
  id: number;
  width: number;
  height: number;
  /** `<source type="image/avif" srcset>` に入れる */
  avifSrcSet: string;
  /** `<img srcset>` に入れる (WebP) */
  webpSrcSet: string;
  /** `<img src>` に入れる (最大の段の WebP) */
  src: string;
};

const PhotoRowSchema = z.object({
  id: z.number(),
  object_key: z.string(),
  sort_order: z.number(),
  width: z.number(),
  height: z.number(),
  variant_widths: z.array(z.number()),
});
type PhotoRow = z.infer<typeof PhotoRowSchema>;
const PHOTO_COLUMNS = 'id, object_key, sort_order, width, height, variant_widths';

/** 写真の ID はサーバーが UUID で決める。取り込みの時はブラウザから戻ってくるので、形を確かめる */
const PhotoIdSchema = z.uuid();

/** 会員の、論理削除していない口コミか。状態も返す (写真を足した後に審査中へ戻ったかを知るため) */
async function findOwnReviewStatus(
  db: SupabaseClient,
  profileId: string,
  reviewId: number
): Promise<string | null> {
  const { data, error } = await db
    .from('reviews')
    .select('status')
    .eq('id', reviewId)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as string | undefined) ?? null;
}

async function countPhotos(db: SupabaseClient, reviewId: number): Promise<number> {
  const { count, error } = await db
    .from('review_images')
    .select('id', { count: 'exact', head: true })
    .eq('review_id', reviewId);
  if (error) throw error;
  return count ?? 0;
}

export type RequestUploadOutcome =
  | { kind: 'ok'; photoId: string; url: string; headers: Record<string, string> }
  | { kind: 'not_found' }
  | { kind: 'full' };

/** 受け取り場所へ上げる署名付き URL を出す。形式と大きさは呼ぶ側が zod で確かめた物を渡す */
export async function requestPhotoUpload(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; file: ReviewPhotoUploadRequest }
): Promise<RequestUploadOutcome> {
  if (!(await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId)))
    return { kind: 'not_found' };
  if ((await countPhotos(ctx.db, input.reviewId)) >= MAX_REVIEW_PHOTOS) return { kind: 'full' };
  const photoId = randomUUID();
  const { url, headers } = await ctx.storage.presignIntakeUpload(
    photoKey(ctx.prefix, input.reviewId, photoId),
    { contentType: input.file.contentType, size: input.file.size }
  );
  return { kind: 'ok', photoId, url, headers };
}

export type IngestOutcome =
  | { kind: 'ok'; photo: OwnReviewPhoto; requeued: boolean }
  | { kind: 'not_found' }
  /** 受け取り場所に写真が無い (上げ損ねた・1 日経って消えた) */
  | { kind: 'missing' }
  | { kind: 'full' }
  | { kind: 'rejected'; reason: ConvertReviewPhotoFailure['reason'] };

/**
 * 受け取った写真を変換して保管側に置き、行を足す。受け取り場所の元の写真は、成否に関わらず消す
 * (残っても R2 のライフサイクルが 1 日で消す)。同じ写真を 2 回取り込んでも、行は 1 つ
 * (object_key の一意の索引)。後から来た方は先の行を返す
 */
export async function ingestPhoto(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; photoId: string }
): Promise<IngestOutcome> {
  if (!PhotoIdSchema.safeParse(input.photoId).success) return { kind: 'missing' };
  const before = await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId);
  if (!before) return { kind: 'not_found' };

  // 受け取り場所と保管側は同じキー (バケットだけが違う)
  const key = photoKey(ctx.prefix, input.reviewId, input.photoId);
  const existing = await findPhotoRow(ctx.db, key);
  if (existing)
    return { kind: 'ok', photo: await toOwnPhoto(ctx.storage, existing), requeued: false };

  let row: PhotoRow;
  try {
    const original = await ctx.storage.readIntake(key);
    if (original.kind === 'missing') return { kind: 'missing' };
    if (original.kind === 'too_large') return { kind: 'rejected', reason: 'too_large' };
    // 数えるのは重い変換の前に断るため。守りは DB のトリガ
    if ((await countPhotos(ctx.db, input.reviewId)) >= MAX_REVIEW_PHOTOS) return { kind: 'full' };

    const converted = await convertReviewPhoto(original.body);
    if (!converted.ok) return { kind: 'rejected', reason: converted.reason };

    const keys = variantKeys(key, converted.variantWidths);
    const cleanUp = () => ctx.storage.deleteStored(keys).catch(() => undefined);
    // 全部の書き込みが終わってから片付ける (途中で消すと、後から終わった物が残る)
    const puts = await Promise.allSettled(
      converted.variants.map(variant =>
        ctx.storage.putStored(
          storedVariantKey(key, variant.width, variant.format),
          variant.body,
          `image/${variant.format}`
        )
      )
    );
    const failedPut = puts.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failedPut) {
      await cleanUp();
      throw failedPut.reason;
    }
    const inserted = await insertPhotoRow(ctx.db, input.reviewId, {
      object_key: key,
      width: converted.width,
      height: converted.height,
      variant_widths: converted.variantWidths,
    }).catch(async (error: unknown) => {
      await cleanUp();
      throw error;
    });
    if (inserted === 'full') {
      await cleanUp();
      return { kind: 'full' };
    }
    if (!inserted) {
      // 同じ写真の取り込みが同時に走り、もう一方が先に行を足した。保管側の物は同じキーなので消さない
      const winner = await findPhotoRow(ctx.db, key);
      if (!winner) throw new Error('review photo row is missing after a duplicate insert');
      return { kind: 'ok', photo: await toOwnPhoto(ctx.storage, winner), requeued: false };
    }
    row = inserted;
  } finally {
    await ctx.storage.deleteIntake(key).catch(() => undefined);
  }
  // 行を足した後の失敗 (URL の署名など) では、保管側の物を消さない (行が指している)。
  // 下書きと審査中以外は、トリガ (requeue_review_on_image_insert) が審査中に戻した
  const requeued = before !== 'draft' && before !== 'pending';
  return { kind: 'ok', photo: await toOwnPhoto(ctx.storage, row), requeued };
}

async function findPhotoRow(db: SupabaseClient, objectKey: string): Promise<PhotoRow | null> {
  const { data, error } = await db
    .from('review_images')
    .select(PHOTO_COLUMNS)
    .eq('object_key', objectKey)
    .maybeSingle();
  if (error) throw error;
  return data ? PhotoRowSchema.parse(data) : null;
}

/** 10 枚のトリガが投げる文 (migration 20261122081202 の limit_review_images と揃える) */
export const MAX_PHOTOS_MESSAGE = `a review can have at most ${MAX_REVIEW_PHOTOS} images`;

/**
 * 行を足す。並び (sort_order) はトリガが最後に付ける。10 枚を超える (トリガが断る) 時は 'full'、
 * 同じ写真の行が既にある時は null (一意の索引で無視する)
 */
async function insertPhotoRow(
  db: SupabaseClient,
  reviewId: number,
  photo: { object_key: string; width: number; height: number; variant_widths: number[] }
): Promise<PhotoRow | 'full' | null> {
  const { data, error } = await db
    .from('review_images')
    .upsert({ review_id: reviewId, ...photo }, { onConflict: 'object_key', ignoreDuplicates: true })
    .select(PHOTO_COLUMNS)
    .maybeSingle();
  if (error) {
    // PostgREST は制約の名前を返さないので、トリガの RAISE の文で見分ける
    if (error.code === '23514' && error.message.includes(MAX_PHOTOS_MESSAGE)) return 'full';
    throw error;
  }
  return data ? PhotoRowSchema.parse(data) : null;
}

/** 会員の口コミの写真を、並びの順に短時間だけ有効な URL 付きで返す */
export async function listOwnPhotos(
  ctx: Pick<PhotoContext, 'db' | 'storage'>,
  input: { profileId: string; reviewId: number }
): Promise<OwnReviewPhoto[]> {
  if (!(await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId))) return [];
  const { data, error } = await ctx.db
    .from('review_images')
    .select(PHOTO_COLUMNS)
    .eq('review_id', input.reviewId)
    .order('sort_order')
    .order('id');
  if (error) throw error;
  return Promise.all(
    z
      .array(PhotoRowSchema)
      .parse(data ?? [])
      .map(row => toOwnPhoto(ctx.storage, row))
  );
}

async function toOwnPhoto(storage: ReviewPhotoStorage, row: PhotoRow): Promise<OwnReviewPhoto> {
  // 段 × 形式の URL をまとめて作る (R2 の署名は手元の計算だけ)
  const [webp, avif] = await Promise.all(
    REVIEW_PHOTO_FORMATS.map(format =>
      Promise.all(
        row.variant_widths.map(async width => ({
          width,
          url: await storage.presignStoredRead(storedVariantKey(row.object_key, width, format)),
        }))
      )
    )
  );
  const toSrcSet = (urls: { width: number; url: string }[]) =>
    urls.map(({ width, url }) => `${url} ${width}w`).join(', ');
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    avifSrcSet: toSrcSet(avif),
    webpSrcSet: toSrcSet(webp),
    // 段は小さい順なので、最後が最大の WebP
    src: webp[webp.length - 1].url,
  };
}

/** 写真を外す。行を消してから、保管側の段を消す (消し損ねても行が無いので見えない) */
export async function removePhoto(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; photoId: number }
): Promise<{ kind: 'removed' } | { kind: 'not_found' }> {
  if (!(await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId)))
    return { kind: 'not_found' };
  const { data, error } = await ctx.db
    .from('review_images')
    .delete()
    .eq('id', input.photoId)
    .eq('review_id', input.reviewId)
    .select('object_key, variant_widths')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { kind: 'not_found' };
  const row = data as { object_key: string; variant_widths: number[] };
  // 行は消えたので、利用者には外せたと返す。保管側の物を消せなかった時は Sentry に残す (行が無いので見えない)
  await ctx.storage.deleteStored(variantKeys(row.object_key, row.variant_widths)).catch(error => {
    Sentry.captureException(error, { tags: { part: 'review-photos', step: 'remove-stored' } });
  });
  return { kind: 'removed' };
}

/** 並びを変える。渡すのは口コミの写真の ID 全部を、見せたい順に (欠け・余りがあれば断る) */
export async function reorderPhotos(
  ctx: Pick<PhotoContext, 'db'>,
  input: { profileId: string; reviewId: number; photoIds: number[] }
): Promise<{ kind: 'reordered' } | { kind: 'not_found' } | { kind: 'mismatch' }> {
  if (!(await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId)))
    return { kind: 'not_found' };
  const { data, error } = await ctx.db
    .from('review_images')
    .select('id')
    .eq('review_id', input.reviewId);
  if (error) throw error;
  const current = new Set((data ?? []).map(row => row.id as number));
  const wanted = new Set(input.photoIds);
  if (
    wanted.size !== input.photoIds.length ||
    wanted.size !== current.size ||
    input.photoIds.some(id => !current.has(id))
  ) {
    return { kind: 'mismatch' };
  }
  // 10 枚までなので、1 枚ずつの更新を並べて送る (sort_order に一意の制約は無い)
  const results = await Promise.all(
    input.photoIds.map((id, index) =>
      ctx.db
        .from('review_images')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('review_id', input.reviewId)
    )
  );
  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;
  return { kind: 'reordered' };
}
