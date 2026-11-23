import 'server-only';

import { randomUUID } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  MAX_REVIEW_PHOTOS,
  ReviewPhotoUploadRequestSchema,
  type ReviewPhotoUploadRequest,
} from '@revolution/schemas/review-photo';
import type { ReviewStatus } from '@revolution/schemas/review';

import { rescreensOnPhotoAdd } from '../eligibility';

import { convertReviewPhoto, type ConvertReviewPhotoFailure } from './convert';
import {
  photoKey,
  storedVariantKey,
  toPhotoView,
  variantKeys,
  type ReviewPhotoStorage,
  type ReviewPhotoView,
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
export type OwnReviewPhoto = ReviewPhotoView;

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
): Promise<ReviewStatus | null> {
  const { data, error } = await db
    .from('reviews')
    .select('status')
    .eq('id', reviewId)
    .eq('user_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as ReviewStatus | undefined) ?? null;
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
  | { kind: 'full' }
  /** 取り込んでいない URL が 1 日の間に 20 ある (上げた後に取り込みを呼ばない使い方を止める) */
  | { kind: 'busy' };

/** CHECK 違反 (トリガが上限で断った時の SQLSTATE) */
const PG_CHECK_VIOLATION = '23514';

/** 取り込んでいない URL が 1 日に 20 ある時にトリガが投げる文 (migration 20261122*_review_photo_uploads と揃える) */
const PENDING_UPLOADS_MESSAGE = 'too many pending review photo uploads';

/** 受け取り場所へ上げる署名付き URL を出す。形式と大きさは呼ぶ側が zod で確かめた物を渡す */
export async function requestPhotoUpload(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; file: ReviewPhotoUploadRequest }
): Promise<RequestUploadOutcome> {
  // 呼ぶ側が確かめた物でも、署名に入れる前にもう一度確かめる (この層が信頼の境目)
  ReviewPhotoUploadRequestSchema.parse(input.file);
  const [status, count] = await Promise.all([
    findOwnReviewStatus(ctx.db, input.profileId, input.reviewId),
    countPhotos(ctx.db, input.reviewId),
  ]);
  if (!status) return { kind: 'not_found' };
  if (count >= MAX_REVIEW_PHOTOS) return { kind: 'full' };
  const photoId = randomUUID();
  // 出した URL を記録する。取り込んでいない記録が 1 日に 20 あれば、トリガが断る (同時に出しても超えない)
  const ticket = await ctx.db
    .from('review_photo_uploads')
    .insert({ photo_id: photoId, review_id: input.reviewId });
  if (ticket.error) {
    if (
      ticket.error.code === PG_CHECK_VIOLATION &&
      ticket.error.message.includes(PENDING_UPLOADS_MESSAGE)
    ) {
      return { kind: 'busy' };
    }
    throw ticket.error;
  }
  try {
    const { url, headers } = await ctx.storage.presignIntakeUpload(
      photoKey(ctx.prefix, input.reviewId, photoId),
      { contentType: input.file.contentType, size: input.file.size }
    );
    return { kind: 'ok', photoId, url, headers };
  } catch (error) {
    // URL を出せなかった記録は数えない (残すと、上げていないのに上限に近づく)
    await deleteTicket(ctx.db, photoId);
    throw error;
  }
}

export type IngestOutcome =
  | { kind: 'ok'; photo: OwnReviewPhoto; requeued: boolean }
  | { kind: 'not_found' }
  /** 受け取り場所に写真が無い (上げ損ねた・1 日経って消えた) */
  | { kind: 'missing' }
  | { kind: 'full' }
  | { kind: 'rejected'; reason: ConvertReviewPhotoFailure['reason'] };

/**
 * 受け取った写真を変換して保管側に置き、行を足す。受け取り場所の元の写真は、取り込めた時と断った時に
 * 消す。一時的な失敗 (投げた時) は残し、同じ写真でやり直せるようにする (R2 のライフサイクルが 1 日で消す)。同じ写真を 2 回取り込んでも、行は 1 つ
 * (object_key の一意の索引)。後から来た方は先の行を返す
 */
export async function ingestPhoto(
  ctx: PhotoContext,
  input: { profileId: string; reviewId: number; photoId: string }
): Promise<IngestOutcome> {
  if (!PhotoIdSchema.safeParse(input.photoId).success) return { kind: 'missing' };
  // 受け取り場所と保管側は同じキー (バケットだけが違う)
  const key = photoKey(ctx.prefix, input.reviewId, input.photoId);
  // 互いに依らない 3 つを一度に読む (口コミの状態・取り込み済みか・URL を出した記録)
  const [before, existing, ticket] = await Promise.all([
    findOwnReviewStatus(ctx.db, input.profileId, input.reviewId),
    findPhotoRow(ctx.db, key),
    ctx.db
      .from('review_photo_uploads')
      .select('photo_id')
      .eq('photo_id', input.photoId)
      .eq('review_id', input.reviewId)
      .maybeSingle(),
  ]);
  if (!before) return { kind: 'not_found' };
  if (existing) {
    // 取り込み済み。元の写真 (位置情報が残っている唯一の物) が残っていれば消す
    await ctx.storage.deleteIntake(key).catch(() => undefined);
    return { kind: 'ok', photo: await toStoredPhotoView(ctx.storage, existing), requeued: false };
  }

  // サーバーが URL を出した写真だけを受け付ける (出した記録が無ければ、受け取り場所も見ない)
  if (ticket.error) throw ticket.error;
  if (!ticket.data) return { kind: 'missing' };

  let row: PhotoRow;
  // 置き場所や DB の一時的な失敗 (投げた時) は、元の写真と出した記録を残してやり直せるようにする (1 日で消える)
  let keepIntake = false;
  try {
    const original = await ctx.storage.readIntake(key);
    if (original.kind === 'missing') {
      // まだ上がっていない。記録は残す (消すと、上げる前に取り込みを呼んで上限を空け、後から上げられてしまう)
      keepIntake = true;
      return { kind: 'missing' };
    }
    if (original.kind === 'too_large') return { kind: 'rejected', reason: 'too_large' };
    // 数えるのは重い変換の前に断るため。守りは DB のトリガ
    if ((await countPhotos(ctx.db, input.reviewId)) >= MAX_REVIEW_PHOTOS) {
      // 1 枚外してからやり直せるように、元の写真を残す (1 日で消える)
      keepIntake = true;
      return { kind: 'full' };
    }

    const converted = await convertReviewPhoto(original.body);
    if (!converted.ok) return { kind: 'rejected', reason: converted.reason };

    const keys = variantKeys(key, converted.variantWidths);
    // 片付けの前に、同じ写真の行が無いかを見る。同時に走ったもう一方の取り込みが行を足していれば、
    // 保管側の物は同じキーでその行が指しているので消さない (10 枚目を取り合って片方が断られた時など)
    // 行を確かめられなかった時も消さない (行が指す物を消すより、使われない物が残る方が害が小さい)
    const cleanUp = async () => {
      const owned = await findPhotoRow(ctx.db, key).then(
        row => row !== null,
        () => true
      );
      if (owned) return;
      await ctx.storage.deleteStored(keys).catch(() => undefined);
    };
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
      const winner = await findPhotoRow(ctx.db, key);
      if (winner)
        return { kind: 'ok', photo: await toStoredPhotoView(ctx.storage, winner), requeued: false };
      await cleanUp();
      keepIntake = true;
      return { kind: 'full' };
    }
    if (!inserted) {
      // 同じ写真の取り込みが同時に走り、もう一方が先に行を足した。保管側の物は同じキーなので消さない
      const winner = await findPhotoRow(ctx.db, key);
      if (!winner) throw new Error('review photo row is missing after a duplicate insert');
      return { kind: 'ok', photo: await toStoredPhotoView(ctx.storage, winner), requeued: false };
    }
    row = inserted;
  } catch (error) {
    keepIntake = true;
    throw error;
  } finally {
    if (!keepIntake) {
      await Promise.all([
        ctx.storage.deleteIntake(key).catch(() => undefined),
        deleteTicket(ctx.db, input.photoId),
      ]);
    }
  }
  // 行を足した後の失敗 (URL の署名など) では、保管側の物を消さない (行が指している)。
  // 下書きと審査中以外は、トリガ (requeue_review_on_image_insert) が審査中に戻した
  const requeued = rescreensOnPhotoAdd(before);
  return { kind: 'ok', photo: await toStoredPhotoView(ctx.storage, row), requeued };
}

/** 出した URL の記録を消す。失敗しても 1 日で片付くので、取り込みの結果は変えない */
async function deleteTicket(db: SupabaseClient, photoId: string): Promise<void> {
  // 失敗は { error } で返る (投げない)。消せなくても 1 日で数えなくなるので、結果は見ない
  await db.from('review_photo_uploads').delete().eq('photo_id', photoId);
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
    if (error.code === PG_CHECK_VIOLATION && error.message.includes(MAX_PHOTOS_MESSAGE))
      return 'full';
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
      .map(row => toStoredPhotoView(ctx.storage, row))
  );
}

/** 保管側の写真を、短時間だけ有効な URL で出す形にする (本人と、管理アプリの BOSS が見る) */
export async function toStoredPhotoView(
  storage: ReviewPhotoStorage,
  row: Pick<PhotoRow, 'id' | 'object_key' | 'width' | 'height' | 'variant_widths'>
): Promise<OwnReviewPhoto> {
  // 段 × 形式の URL を先にまとめて署名する (R2 の署名は手元の計算だけ)
  const keys = variantKeys(row.object_key, row.variant_widths);
  const urls = await Promise.all(keys.map(key => storage.presignStoredRead(key)));
  const urlOf = new Map(keys.map((key, i) => [key, urls[i]]));
  return toPhotoView(row, key => urlOf.get(key)!);
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
  // 行は消えたので、利用者には外せたと返す。配信側 (公開中だった時) と保管側の物を消す。
  // 消せなかった時は Sentry に残す (配信側に残った物は、行が無いので公開の画面からは指されない)
  // 保管側を先に消す (同時に走った同期が、この後に配信側へ写し直せないように)。その後で配信側を消す
  const keys = variantKeys(row.object_key, row.variant_widths);
  await ctx.storage.deleteStored(keys).catch(error => {
    Sentry.captureException(error, { tags: { part: 'review-photos', step: 'remove-stored' } });
  });
  await ctx.storage.unpublish(keys).catch(error => {
    Sentry.captureException(error, { tags: { part: 'review-photos', step: 'remove-public' } });
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
