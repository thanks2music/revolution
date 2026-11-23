import { z } from 'zod';

import { toPhotoView, type ReviewPhotoView } from './storage';

export { publicMediaBaseUrl } from './storage';

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

export type PublicReviewPhoto = ReviewPhotoView;

export function toPublicPhoto(
  baseUrl: string,
  row: z.infer<typeof PublicPhotoRowSchema>
): PublicReviewPhoto {
  return toPhotoView(row, key => `${baseUrl}/${key}`);
}
