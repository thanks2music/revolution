import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { variantKeys, type ReviewPhotoStorage } from './storage';

/**
 * 配信側の写真を、口コミの今の状態に合わせる (one-more-time #164)。
 *
 * 配信側に置くのは「公開中で、論理削除していない口コミ」の「非公開でない写真」の物だけ。それ以外の
 * 写真 (審査中・差し戻し・確認待ち・非公開・削除・写真の非公開) の物は消し、CDN のキャッシュも消す。
 *
 * 状態から求めるので、何度呼んでもよい (審査の後・削除の後など、状態が変わりうる所で呼ぶ)。
 * 行の無くなった写真 (外した写真) の物は、ここでは分からないので、呼ぶ側が `unpublishPhoto` で消す。
 */
export async function syncPhotoDelivery(
  ctx: { db: SupabaseClient; storage: ReviewPhotoStorage },
  reviewId: number
): Promise<{ published: number; unpublished: number }> {
  const [review, photos] = await Promise.all([
    ctx.db.from('reviews').select('status, deleted_at').eq('id', reviewId).maybeSingle(),
    ctx.db
      .from('review_images')
      .select('object_key, variant_widths, hidden_at')
      .eq('review_id', reviewId),
  ]);
  if (review.error) throw review.error;
  if (photos.error) throw photos.error;

  const live = review.data?.status === 'published' && !review.data.deleted_at;
  const rows = (photos.data ?? []) as {
    object_key: string;
    variant_widths: number[];
    hidden_at: string | null;
  }[];
  const show = rows.filter(row => live && !row.hidden_at);
  const hide = rows.filter(row => !show.includes(row));

  const keysOf = (list: typeof rows) =>
    list.flatMap(row => variantKeys(row.object_key, row.variant_widths));
  // 消す方を先にする (同じ写真が両方に入ることは無いが、失敗した時に「出したまま」を残しにくくする)
  await ctx.storage.unpublish(keysOf(hide));
  await ctx.storage.publish(keysOf(show));
  return { published: show.length, unpublished: hide.length };
}

/** 行の無くなった写真の物を、配信側から消す (外した写真) */
export async function unpublishPhoto(
  storage: ReviewPhotoStorage,
  photo: { objectKey: string; variantWidths: number[] }
): Promise<void> {
  await storage.unpublish(variantKeys(photo.objectKey, photo.variantWidths));
}
