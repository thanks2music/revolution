import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  AVATAR_SCREENING_WIDTH,
  AVATAR_WIDTHS,
  type AvatarRejectReason,
  type AvatarStatus,
} from '@revolution/schemas/profile-avatar';
import {
  ReviewPhotoUploadRequestSchema,
  type ReviewPhotoUploadRequest,
} from '@revolution/schemas/review-photo';

import { convertSquareImage, type ConvertReviewPhotoFailure } from '../photos/convert';
import {
  REVIEW_PHOTO_FORMATS,
  storedVariantKey,
  variantKeys,
  type ReviewPhotoStorage,
} from '../photos/storage';

import type { AvatarScreener } from './screener';

/**
 * プロフィール画像の操作 (one-more-time #171)。Server Action はこの層だけを呼ぶ。
 *
 * 口コミの写真と同じ置き場所 (`ReviewPhotoStorage`) を、キーの頭 `profiles/<profileId>/<画像の ID>` で使う:
 * 受け取り (ブラウザが上げる) → 変換 (正方形の 64/128/256) → 非公開の保管 → 審査 → 通れば公開の配信に写す。
 *
 * - db は service role のクライアント (画像の列を書くのはサーバーだけ。0031)。profileId は呼ぶ側がログインから決める
 * - 状態: 設定すると審査中 (`pending`)。通れば公開 (`published`)、落ちれば落ちた (`rejected` + 理由) で、
 *   保管側と配信側の物を消す。審査中でも外せる (外すと審査をやめる)。BOSS が外した (`removed`) 会員は設定できない
 * - 審査の結果を書く時は、キーが審査を始めた時のままかを条件にする (途中で替えた・外した時は何もしない)
 * - throw せず型付きの結果を返す。置き場所・DB の障害だけを投げる (呼ぶ側が Sentry に送る)
 */
export type AvatarContext = {
  db: SupabaseClient;
  storage: ReviewPhotoStorage;
  /** キーの先頭 (`reviewPhotoKeyPrefix`) */
  prefix: string;
};

export function avatarKey(prefix: string, profileId: string, imageId: string): string {
  return `${prefix}profiles/${profileId}/${imageId}`;
}

/** 1 つの画像の、保管側・配信側の物のキー全部 */
export function avatarVariantKeys(key: string): string[] {
  return variantKeys(key, AVATAR_WIDTHS);
}

const ImageIdSchema = z.uuid();
const PG_CHECK_VIOLATION = '23514';
/** 取り込んでいない URL が 1 日に 10 ある時にトリガが投げる文 (migration 0031 と揃える) */
const PENDING_UPLOADS_MESSAGE = 'too many pending profile avatar uploads';

const AvatarRowSchema = z.object({
  avatar_key: z.string().nullable(),
  avatar_status: z.enum(['pending', 'published', 'rejected', 'removed']).nullable(),
  avatar_reason_code: z.enum(['sexual_or_violent', 'unverifiable']).nullable(),
  avatar_removed_at: z.string().nullable(),
});
const AVATAR_COLUMNS = 'avatar_key, avatar_status, avatar_reason_code, avatar_removed_at';

/** 本人に見せる画像の状態 (マイページ・プロフィール編集)。キーは公開・審査中の時だけ */
export type OwnAvatar = {
  status: AvatarStatus | null;
  key: string | null;
  reasonCode: AvatarRejectReason | null;
  /** BOSS が外した (以後は設定できない) */
  removed: boolean;
};

export async function readOwnAvatar(db: SupabaseClient, profileId: string): Promise<OwnAvatar> {
  const { data, error } = await db
    .from('profiles')
    .select(AVATAR_COLUMNS)
    .eq('id', profileId)
    .single();
  if (error) throw error;
  const row = AvatarRowSchema.parse(data);
  return {
    status: row.avatar_status,
    key: row.avatar_key,
    reasonCode: row.avatar_reason_code,
    removed: row.avatar_removed_at !== null,
  };
}

export type RequestAvatarUploadOutcome =
  | { kind: 'ok'; imageId: string; url: string; headers: Record<string, string> }
  /** BOSS が外した会員 */
  | { kind: 'removed' }
  /** 取り込んでいない URL が多すぎる */
  | { kind: 'busy' };

/** 受け取り場所へ上げる署名付き URL を出す。形式と大きさは口コミの写真と同じ決まり */
export async function requestAvatarUpload(
  ctx: AvatarContext,
  input: { profileId: string; file: ReviewPhotoUploadRequest }
): Promise<RequestAvatarUploadOutcome> {
  ReviewPhotoUploadRequestSchema.parse(input.file);
  if ((await readOwnAvatar(ctx.db, input.profileId)).removed) return { kind: 'removed' };
  const imageId = randomUUID();
  const ticket = await ctx.db
    .from('profile_avatar_uploads')
    .insert({ image_id: imageId, profile_id: input.profileId });
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
      avatarKey(ctx.prefix, input.profileId, imageId),
      { contentType: input.file.contentType, size: input.file.size }
    );
    return { kind: 'ok', imageId, url, headers };
  } catch (error) {
    await deleteTicket(ctx.db, imageId);
    throw error;
  }
}

export type AttachAvatarOutcome =
  /** 審査中になった。`key` は審査に渡す */
  | { kind: 'ok'; key: string }
  /** 受け取り場所に画像が無い (上げ損ねた・1 日経って消えた)、またはサーバーが出した URL の画像でない */
  | { kind: 'missing' }
  | { kind: 'removed' }
  | { kind: 'rejected'; reason: ConvertReviewPhotoFailure['reason'] };

/**
 * 受け取った画像を変換して保管側に置き、審査中にする。前の画像 (審査中・公開) は保管側と配信側から消す。
 * 受け取り場所の元の画像は、取り込めた時と断った時に消す。一時的な失敗 (投げた時) は残してやり直せるようにする
 */
export async function attachAvatar(
  ctx: AvatarContext,
  input: { profileId: string; imageId: string }
): Promise<AttachAvatarOutcome> {
  if (!ImageIdSchema.safeParse(input.imageId).success) return { kind: 'missing' };
  const key = avatarKey(ctx.prefix, input.profileId, input.imageId);
  const [before, ticket] = await Promise.all([
    readOwnAvatar(ctx.db, input.profileId),
    ctx.db
      .from('profile_avatar_uploads')
      .select('image_id')
      .eq('image_id', input.imageId)
      .eq('profile_id', input.profileId)
      .maybeSingle(),
  ]);
  if (before.removed) return { kind: 'removed' };
  // 取り込み済み (同じ画像を 2 回送った)。審査中のまま返す
  if (before.key === key) return { kind: 'ok', key };
  if (ticket.error) throw ticket.error;
  if (!ticket.data) return { kind: 'missing' };

  let keepIntake = false;
  try {
    const original = await ctx.storage.readIntake(key);
    if (original.kind === 'missing') {
      keepIntake = true;
      return { kind: 'missing' };
    }
    if (original.kind === 'too_large') return { kind: 'rejected', reason: 'too_large' };

    const converted = await convertSquareImage(original.body, AVATAR_WIDTHS);
    if (!converted.ok) return { kind: 'rejected', reason: converted.reason };

    const keys = avatarVariantKeys(key);
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
      await ctx.storage.deleteStored(keys).catch(() => undefined);
      throw failedPut.reason;
    }
    // 外されていない時だけ書く (外した会員は CHECK でも断られる)
    const { data: updated, error } = await ctx.db
      .from('profiles')
      .update({ avatar_key: key, avatar_status: 'pending', avatar_reason_code: null })
      .eq('id', input.profileId)
      .is('avatar_removed_at', null)
      .select('id');
    if (error) {
      await ctx.storage.deleteStored(keys).catch(() => undefined);
      throw error;
    }
    if (!updated?.length) {
      await ctx.storage.deleteStored(keys).catch(() => undefined);
      return { kind: 'removed' };
    }
    if (before.key) await deleteAvatarObjects(ctx.storage, before.key);
    return { kind: 'ok', key };
  } catch (error) {
    keepIntake = true;
    throw error;
  } finally {
    if (!keepIntake) {
      await Promise.all([
        ctx.storage.deleteIntake(key).catch(() => undefined),
        deleteTicket(ctx.db, input.imageId),
      ]);
    }
  }
}

/**
 * 画像を外す (審査中でも。外すと審査をやめる)。落ちた理由も消して未設定に戻す。BOSS が外した会員は何もしない
 */
export async function removeAvatar(
  ctx: Pick<AvatarContext, 'db' | 'storage'>,
  profileId: string
): Promise<{ kind: 'ok' } | { kind: 'removed' }> {
  const before = await readOwnAvatar(ctx.db, profileId);
  if (before.removed) return { kind: 'removed' };
  const { error } = await ctx.db
    .from('profiles')
    .update({ avatar_key: null, avatar_status: null, avatar_reason_code: null })
    .eq('id', profileId)
    .is('avatar_removed_at', null);
  if (error) throw error;
  if (before.key) await deleteAvatarObjects(ctx.storage, before.key);
  return { kind: 'ok' };
}

export type ScreenAvatarOutcome =
  | { kind: 'published' }
  | { kind: 'rejected'; reasonCode: AvatarRejectReason }
  /** 審査の途中で画像が替わった・外された */
  | { kind: 'skipped' };

/**
 * 審査中の画像を審査する (Server Action の `after()` から)。通れば配信側に写して公開、落ちれば (審査の失敗も)
 * 落ちたにして保管側と配信側から消す。結果は、キーが `key` のまま審査中の時だけ書く
 */
export async function screenAvatar(
  ctx: Pick<AvatarContext, 'db' | 'storage'> & { screener: AvatarScreener },
  input: { profileId: string; key: string }
): Promise<ScreenAvatarOutcome> {
  const before = await readOwnAvatar(ctx.db, input.profileId);
  if (before.key !== input.key || before.status !== 'pending') return { kind: 'skipped' };

  const image = await ctx.storage.readStored(
    storedVariantKey(input.key, AVATAR_SCREENING_WIDTH, 'webp')
  );
  const result = image
    ? await ctx.screener.screen({ data: image, mimeType: 'image/webp' })
    : ({ ok: false, error: 'stored image is missing', model: null } as const);

  if (result.ok && result.decision === 'ok') {
    const keys = avatarVariantKeys(input.key);
    await ctx.storage.publish(keys);
    const { data: updated, error } = await ctx.db
      .from('profiles')
      .update({ avatar_status: 'published' })
      .eq('id', input.profileId)
      .eq('avatar_key', input.key)
      .eq('avatar_status', 'pending')
      .select('id');
    if (error) throw error;
    if (!updated?.length) {
      // 写している間に替わった・外された。写した物を引き上げる
      await ctx.storage.unpublish(keys);
      return { kind: 'skipped' };
    }
    return { kind: 'published' };
  }

  const reasonCode: AvatarRejectReason = result.ok ? 'sexual_or_violent' : 'unverifiable';
  const { data: updated, error } = await ctx.db
    .from('profiles')
    .update({ avatar_key: null, avatar_status: 'rejected', avatar_reason_code: reasonCode })
    .eq('id', input.profileId)
    .eq('avatar_key', input.key)
    .eq('avatar_status', 'pending')
    .select('id');
  if (error) throw error;
  if (!updated?.length) return { kind: 'skipped' };
  await deleteAvatarObjects(ctx.storage, input.key);
  return { kind: 'rejected', reasonCode };
}

/**
 * 画像の物を保管側と配信側から消す (外した・替えた・落ちた・退会の時)。配信側は CDN のキャッシュも消える。
 * 退会の処理は、auth の会員を消す前にキーを読み、消した後にこれを呼ぶ (退会のトリガがキーを空にするため)
 */
export async function deleteAvatarObjects(storage: ReviewPhotoStorage, key: string): Promise<void> {
  const keys = avatarVariantKeys(key);
  await Promise.all([storage.deleteStored(keys), storage.unpublish(keys)]);
}

/** 公開の画像を `<picture>` で出す形。キーは `avatar_public_key` (公開の時だけ値がある) */
export type AvatarView = { avifSrcSet: string; webpSrcSet: string; src: string };

export function toAvatarView(baseUrl: string, key: string): AvatarView {
  const url = (width: number, format: (typeof REVIEW_PHOTO_FORMATS)[number]) =>
    `${baseUrl}/${storedVariantKey(key, width, format)}`;
  const srcSet = (format: (typeof REVIEW_PHOTO_FORMATS)[number]) =>
    AVATAR_WIDTHS.map(width => `${url(width, format)} ${width}w`).join(', ');
  return {
    avifSrcSet: srcSet('avif'),
    webpSrcSet: srcSet('webp'),
    src: url(AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1], 'webp'),
  };
}

async function deleteTicket(db: SupabaseClient, imageId: string): Promise<void> {
  await db.from('profile_avatar_uploads').delete().eq('image_id', imageId);
}
