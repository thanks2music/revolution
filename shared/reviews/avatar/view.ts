import { AVATAR_WIDTHS } from '@revolution/schemas/profile-avatar';

/**
 * 公開のプロフィール画像を `<picture>` で出す形 (one-more-time #171)。キーは `profiles.avatar_public_key`
 * (公開の時だけ値がある)。配信側には保管側と同じキーで、段ごとに `<key>/<幅>.<webp|avif>` が置いてある
 * (`./operations.ts` の `avatarVariantKeys`)。画面からも読むので、`server-only` や画像の処理を持ち込まない
 */
export type AvatarView = { avifSrcSet: string; webpSrcSet: string; src: string };

export function toAvatarView(baseUrl: string, key: string): AvatarView {
  const url = (width: number, format: 'webp' | 'avif') => `${baseUrl}/${key}/${width}.${format}`;
  const srcSet = (format: 'webp' | 'avif') =>
    AVATAR_WIDTHS.map(width => `${url(width, format)} ${width}w`).join(', ');
  return {
    avifSrcSet: srcSet('avif'),
    webpSrcSet: srcSet('webp'),
    src: url(AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1], 'webp'),
  };
}
