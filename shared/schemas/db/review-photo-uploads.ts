import { bigint, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { reviews } from './reviews';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.review_photo_uploads (0022、one-more-time #163)
 *
 * 写真を上げる署名付き URL を出した記録。出すたびに 1 行を足し、取り込んだら消す。
 * - 1 つの口コミについて、期限内 (10 分) の行が 10 に達していたら、トリガ
 *   (`trg_review_photo_uploads_limit`) が新しい行を断る。口コミの行を FOR UPDATE で押さえてから数える
 * - 取り込みは、この行がある写真だけを受け付ける (サーバーが出した URL の写真だけ)
 * - 読み書きはサーバー (service role) だけ。RLS を有効にし、policy は置かない
 */
export const reviewPhotoUploads = pgTable(
  'review_photo_uploads',
  {
    photoId: uuid('photo_id').primaryKey(),
    reviewId: bigint('review_id', { mode: 'number' })
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_photo_uploads_review_idx').on(table.reviewId, table.createdAt)],
).enableRLS();
