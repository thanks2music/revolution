import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { MAX_REVIEW_PHOTOS, type ReviewPhotoUploadRequest } from '@revolution/schemas/review-photo';

import { convertReviewPhoto, type ConvertReviewPhotoFailure } from './convert';
import { intakeKey, storedPhotoKey, storedVariantKey, type ReviewPhotoStorage } from './storage';

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
    intakeKey(ctx.prefix, input.reviewId, photoId),
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
 * (残っても R2 のライフサイクルが 1 日で消す)
 */
export async function ingestPhoto(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; photoId: string }
): Promise<IngestOutcome> {
  if (!PhotoIdSchema.safeParse(input.photoId).success) return { kind: 'missing' };
  const before = await findOwnReviewStatus(ctx.db, input.profileId, input.reviewId);
  if (!before) return { kind: 'not_found' };

  const intake = intakeKey(ctx.prefix, input.reviewId, input.photoId);
  try {
    const original = await ctx.storage.readIntake(intake);
    if (!original) return { kind: 'missing' };
    if ((await countPhotos(ctx.db, input.reviewId)) >= MAX_REVIEW_PHOTOS) return { kind: 'full' };

    const converted = await convertReviewPhoto(original);
    if (!converted.ok) return { kind: 'rejected', reason: converted.reason };

    const objectKey = storedPhotoKey(ctx.prefix, input.reviewId, input.photoId);
    const keys = converted.variants.map(variant =>
      storedVariantKey(objectKey, variant.width, variant.format)
    );
    try {
      await Promise.all(
        converted.variants.map((variant, i) =>
          ctx.storage.putStored(keys[i], variant.body, `image/${variant.format}`)
        )
      );
      const row = await insertPhotoRow(ctx.db, input.reviewId, {
        object_key: objectKey,
        width: converted.width,
        height: converted.height,
        variant_widths: converted.variantWidths,
      });
      if (!row) {
        await ctx.storage.deleteStored(keys);
        return { kind: 'full' };
      }
      const requeued = ['published', 'rejected', 'needs_review', 'hidden'].includes(before);
      return { kind: 'ok', photo: await toOwnPhoto(ctx.storage, row), requeued };
    } catch (error) {
      // 行を足せなかった写真を保管側に残さない
      await ctx.storage.deleteStored(keys).catch(() => undefined);
      throw error;
    }
  } finally {
    await ctx.storage.deleteIntake(intake).catch(() => undefined);
  }
}

/** 行を足す。10 枚を超える (トリガが断る) 時は null */
async function insertPhotoRow(
  db: SupabaseClient,
  reviewId: number,
  photo: { object_key: string; width: number; height: number; variant_widths: number[] }
): Promise<PhotoRow | null> {
  const last = await db
    .from('review_images')
    .select('sort_order')
    .eq('review_id', reviewId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) throw last.error;
  const { data, error } = await db
    .from('review_images')
    .insert({
      review_id: reviewId,
      sort_order: ((last.data?.sort_order as number | undefined) ?? -1) + 1,
      ...photo,
    })
    .select(PHOTO_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23514' && error.message.includes('at most 10 images')) return null;
    throw error;
  }
  return PhotoRowSchema.parse(data);
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
  const srcSet = async (format: 'webp' | 'avif') =>
    (
      await Promise.all(
        row.variant_widths.map(
          async width =>
            `${await storage.presignStoredRead(storedVariantKey(row.object_key, width, format))} ${width}w`
        )
      )
    ).join(', ');
  const largest = Math.max(...row.variant_widths);
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    avifSrcSet: await srcSet('avif'),
    webpSrcSet: await srcSet('webp'),
    src: await storage.presignStoredRead(storedVariantKey(row.object_key, largest, 'webp')),
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
  await ctx.storage.deleteStored(
    row.variant_widths.flatMap(width => [
      storedVariantKey(row.object_key, width, 'webp'),
      storedVariantKey(row.object_key, width, 'avif'),
    ])
  );
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
  // 10 枚までなので 1 枚ずつ書く (sort_order に一意の制約は無い)
  for (const [index, id] of input.photoIds.entries()) {
    const { error: updateError } = await ctx.db
      .from('review_images')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('review_id', input.reviewId);
    if (updateError) throw updateError;
  }
  return { kind: 'reordered' };
}
