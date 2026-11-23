import 'server-only';

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

import { variantKeys, type ReviewPhotoStorage } from './storage';

/**
 * 配信側の写真を、口コミの今の状態に合わせる (one-more-time #164)。
 *
 * 配信側に置くのは「公開中で、論理削除していない口コミ」の「非公開でない写真」の物だけ。それ以外の
 * 写真 (審査中・差し戻し・確認待ち・非公開・削除・写真の非公開) の物は消し、CDN のキャッシュも消す。
 *
 * 状態から求めるので、何度呼んでもよい (審査の後・削除の後など、状態が変わりうる所で呼ぶ)。同時に
 * 走っても、最後の同期の状態に揃う。行の無くなった写真 (外した写真) の物は、`removePhoto` が消す。
 *
 * 消すのと写すのは片方が失敗しても両方試し、失敗はまとめて投げる。写した後に状態を読み直し、その間に
 * 出せなくなった写真 (口コミが公開でなくなった・写真が非公開になった・外された) の物を消す。
 */
type Ctx = { db: SupabaseClient; storage: ReviewPhotoStorage };

type DeliveryRow = { object_key: string; variant_widths: number[]; hidden_at: string | null };

/** 口コミが公開中か (公開で、論理削除していない) */
async function isLive(db: SupabaseClient, reviewId: number): Promise<boolean> {
  const { data, error } = await db
    .from('reviews')
    .select('status, deleted_at')
    .eq('id', reviewId)
    .maybeSingle();
  if (error) throw error;
  return data?.status === 'published' && !data.deleted_at;
}

const keysOf = (rows: DeliveryRow[]) =>
  rows.flatMap(row => variantKeys(row.object_key, row.variant_widths));

/** 配信側に置いてよい写真 (口コミが公開中なら非公開でない写真、それ以外は無し) と、全部の写真 */
async function readDelivery(db: SupabaseClient, reviewId: number) {
  const [live, photos] = await Promise.all([
    isLive(db, reviewId),
    db
      .from('review_images')
      .select('object_key, variant_widths, hidden_at')
      .eq('review_id', reviewId),
  ]);
  if (photos.error) throw photos.error;
  const rows = (photos.data ?? []) as DeliveryRow[];
  return { rows, show: live ? rows.filter(row => !row.hidden_at) : [] };
}

export async function syncPhotoDelivery(
  ctx: Ctx,
  reviewId: number
): Promise<{ published: number; unpublished: number }> {
  const { rows, show } = await readDelivery(ctx.db, reviewId);
  const shown = new Set(show.map(row => row.object_key));
  const hide = rows.filter(row => !shown.has(row.object_key));

  const results = await Promise.allSettled([
    ctx.storage.unpublish(keysOf(hide)),
    ctx.storage.publish(keysOf(show)),
  ]);
  // 写した後に読み直す。写している間に出せなくなった写真 (同時に走った削除・審査・写真を外す) の物を消す
  if (show.length > 0) {
    const after = new Set((await readDelivery(ctx.db, reviewId)).show.map(row => row.object_key));
    const stale = show.filter(row => !after.has(row.object_key));
    if (stale.length > 0) await ctx.storage.unpublish(keysOf(stale));
  }

  const failures = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) throw new AggregateError(failures, 'photo delivery failed');
  return { published: show.length, unpublished: hide.length };
}

/**
 * 配信側を合わせ、失敗は Sentry に残して投げない (状態の書き込みや応答を止めない)。
 * 失敗した物は、次の同期 (編集・削除・審査) で直る
 */
export async function syncPhotoDeliverySafely(ctx: Ctx, reviewId: number): Promise<void> {
  await syncPhotoDelivery(ctx, reviewId).catch(error => {
    Sentry.captureException(error, { tags: { part: 'review-photos', step: 'delivery' } });
  });
}
