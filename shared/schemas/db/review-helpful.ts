import { bigint, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { reviews } from './reviews';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.review_helpful
 *
 * レビューへの「参考になった」(★案 A、2026-08-02 BOSS 確定)。
 * **v3 仕様には存在しなかったテーブル**で、2026-08 のデザイン要求から追加された。
 *
 * 設計判断 (S0「設計確定」、一次資料
 * `one-more-time/docs/schema/revolution-schema.ts` + `revolution-er-v3.md` §5-5):
 * - 複合 PK `(review_id, user_id)` = 1 レビュー 1 ユーザー 1 回。
 * - `user_id` は `profiles.id` (永続 ID) を ON DELETE restrict で参照
 *   (reviews と同じく、退会しても「参考になった」の件数を保つため)。
 * - **UPDATE policy は作らない**。トグルは INSERT / DELETE で表現する
 *   (`favorites` と同じ作法)。そのため更新経路は 2 つだけで、
 *   `private.apply_review_helpful_delta()` も INSERT / DELETE 分岐だけを持つ。
 * - 行は **本人にしか見せない** (誰が押したかは非公開)。匿名ユーザー向けの
 *   件数は `reviews.helpful_count` に集約して公開する (案 A)。
 *   案 B (本テーブルに select policy を足して全員可視) は「誰が何を参考にしたか」
 *   が PostgREST で全件取得でき、閲覧履歴に近い情報になるため不採用。
 *
 * ★ `review_helpful_user_idx` は必須。複合 PK は `(review_id, user_id)` の順の
 *   ため **user_id 単独検索が leftmost prefix に該当しない**
 *   (`event_categories_category_idx` と同じ理由)。RLS の select / delete policy
 *   が `user_id in (select ...)` で引くため、これがないと全件スキャンになる。
 *
 * トリガ (0013 の custom SQL):
 *   - `trg_review_helpful_delta` (AFTER INSERT/DELETE) →
 *     `reviews.helpful_count` を ±1
 */
export const reviewHelpful = pgTable(
  'review_helpful',
  {
    reviewId: bigint('review_id', { mode: 'number' })
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 レビュー 1 ユーザー 1 回。
    primaryKey({ columns: [table.reviewId, table.userId] }),
    // ★ 複合 PK の 2 列目は leftmost prefix に該当しないため単独 index が必要。
    index('review_helpful_user_idx').on(table.userId),
  ],
);

export type ReviewHelpfulRow = typeof reviewHelpful.$inferSelect;
export type ReviewHelpfulInsert = typeof reviewHelpful.$inferInsert;
