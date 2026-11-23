import { z } from 'zod';

import { presentEnvValue } from '@revolution/slack/env';

import { REVIEW_PHOTO_FORMATS, storedVariantKey } from './storage';

/**
 * 公開中の口コミの写真を、配信側の URL で出す形にする (one-more-time #164、#3 の写真とギャラリー)。
 *
 * 配信側には、公開中の口コミの非公開でない写真だけが写っている (`delivery.ts`)。読む行も同じ条件に
 * RLS で絞ってある (migration 0024)。URL は配信側の基点 + 保管側と同じキー。
 */

export const PublicPhotoRowSchema = z.object({
  id: z.number(),
  object_key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  variant_widths: z.array(z.number().int().positive()).min(1),
});

export type PublicPhotoRow = z.infer<typeof PublicPhotoRowSchema>;

export type PublicReviewPhoto = {
  id: number;
  width: number;
  height: number;
  /** `<source type="image/avif" srcset>` に入れる */
  avifSrcSet: string;
  /** `<img srcset>` に入れる (WebP) */
  webpSrcSet: string;
  /** `<img src>` と拡大表示に使う (最大の段の WebP) */
  src: string;
};

/**
 * 配信側の基点 (末尾の / を外す)。無ければ写真を出さない (壊れた画像を出さないため)。
 * `op://` のままの値は、置き場所の設定 (`getReviewPhotoStorage`) と同じく未設定として扱う
 */
export function publicMediaBaseUrl(value: string | undefined): string | null {
  const trimmed = presentEnvValue(value)?.replace(/\/+$/, '');
  return trimmed ? trimmed : null;
}

export function toPublicPhoto(baseUrl: string, row: PublicPhotoRow): PublicReviewPhoto {
  const widths = [...row.variant_widths].sort((a, b) => a - b);
  const [webp, avif] = REVIEW_PHOTO_FORMATS.map(format =>
    widths.map(width => ({
      width,
      url: `${baseUrl}/${storedVariantKey(row.object_key, width, format)}`,
    }))
  );
  const toSrcSet = (urls: { width: number; url: string }[]) =>
    urls.map(({ width, url }) => `${url} ${width}w`).join(', ');
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    avifSrcSet: toSrcSet(avif),
    webpSrcSet: toSrcSet(webp),
    src: webp[webp.length - 1].url,
  };
}
