import {
  AVATAR_WIDTHS,
  type AvatarRejectReason,
  type AvatarStatus,
} from '@revolution/schemas/profile-avatar';

import { storedVariantKey, type StoredPhotoFormat } from '../photos/storage';

/**
 * 公開のプロフィール画像を `<picture>` で出す形 (one-more-time #171)。キーは `profiles.avatar_public_key`
 * (公開の時だけ値がある)。配信側には保管側と同じキーで、段ごとに `<key>/<幅>.<webp|avif>` が置いてある
 * (`./operations.ts` の `avatarVariantKeys`)。形はサーバーで作る。画面 (クライアント) からは型だけを読む
 */
export type AvatarView = { avifSrcSet: string; webpSrcSet: string; src: string };

export function toAvatarView(baseUrl: string, key: string): AvatarView {
  const url = (width: number, format: StoredPhotoFormat) =>
    `${baseUrl}/${storedVariantKey(key, width, format)}`;
  const srcSet = (format: StoredPhotoFormat) =>
    AVATAR_WIDTHS.map(width => `${url(width, format)} ${width}w`).join(', ');
  return {
    avifSrcSet: srcSet('avif'),
    webpSrcSet: srcSet('webp'),
    src: url(AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1], 'webp'),
  };
}

/** 本人に見せる画像の状態 (マイページ・プロフィール編集・オンボーディング)。状態と理由はサーバーが service role で読む */
export type OwnAvatarState = {
  status: AvatarStatus | null;
  /** 公開の時だけ */
  view: AvatarView | null;
  reasonCode: AvatarRejectReason | null;
  /** BOSS が通報を受けて外した (以後は設定できない) */
  removed: boolean;
};
