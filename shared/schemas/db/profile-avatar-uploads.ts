import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.profile_avatar_uploads (0031、one-more-time #171)
 *
 * プロフィール画像を上げる署名付き URL を出した記録。口コミの写真の `review_photo_uploads` と同じ作り。
 * - 出すたびに 1 行を足し、取り込んだら (または取り込みで断ったら) 消す
 * - 1 人の会員について、1 日の間に取り込んでいない行が 10 あれば、トリガ
 *   (`trg_profile_avatar_uploads_limit`) が新しい行を断る。会員の行を FOR UPDATE で押さえてから数える
 * - 取り込みは、この行がある画像だけを受け付ける (サーバーが出した URL の画像だけ)
 * - 読み書きはサーバー (service role) だけ。RLS を有効にし、policy は置かない
 */
export const profileAvatarUploads = pgTable(
  'profile_avatar_uploads',
  {
    imageId: uuid('image_id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('profile_avatar_uploads_profile_idx').on(table.profileId, table.createdAt)]
).enableRLS();
