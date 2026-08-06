import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { occurrences } from './occurrences';
import { profiles } from './profiles';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.reviews
 *
 * レビュー本体 (開催に紐づく永続データの中核・ソフトデリート)。
 *
 * 設計判断 (S0「設計確定」2026-08-02〜08-03、一次資料
 * `one-more-time/docs/schema/revolution-schema.ts` + `revolution-er-v3.md` §4-2):
 * - `user_id` は **`profiles.id` (永続 ID)** を参照する。`auth_user_id` ではない。
 *   退会してもレビューを残すため `ON DELETE restrict` (M1 = migration 0011 で
 *   profiles の認証 ID / 永続 ID を分離済み)。
 * - `unique(occurrence_id, user_id)` = 1 開催 1 ユーザー 1 レビュー。
 * - `rating` は 1-5 の CHECK 制約付き smallint。
 * - `deleted_at` でソフトデリート。集計トリガは `deleted_at is null` の行だけを
 *   有効として加算する。**物理削除の経路は用意しない** (DELETE policy を作らず、
 *   運用上の「削除」は UPDATE で `deleted_at` を立てる)。
 * - `helpful_count` は「参考になった」件数の非正規化キャッシュ (★案 A、
 *   2026-08-02 BOSS 確定)。`review_helpful` の insert/delete を
 *   `private.apply_review_helpful_delta()` が差分反映する。件数表示のたびに
 *   `count(*)` を撃たないため。
 *   **自己インフレ防止のため `authenticated` への UPDATE は列単位 GRANT で
 *   本カラムを除外している** (0013 の `grant update (rating, body, visited_on,
 *   deleted_at)`)。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK):
 *   rating:
 *     Layer1 = zod (`shared/schemas/review.ts`、`.int().min(1).max(5)`)
 *     Layer2 = DB CHECK (`rating between 1 and 5`)
 *   body:
 *     Layer1 = zod (`.min(1).nullable().optional()`)
 *     Layer2 = DB CHECK (NULL or `btrim(..., E' \t\n\r　') <> ''`、Unicode-aware)
 *
 * ★ `reviews_user_idx` は **必須**。`user_id` 単独の検索経路が 3 つある:
 *   (1) RLS 述語 (本人のレビューか判定) / (2) profiles 削除時の ON DELETE
 *   RESTRICT チェック / (3) マイページの「自分のレビュー一覧」。
 *   複合 unique `(occurrence_id, user_id)` の 2 列目は leftmost prefix に該当
 *   せず単独検索に使われないため、これがないと 3 経路とも全件スキャンになる
 *   (Supabase 公式 security-rls-performance「Always add indexes on columns used
 *   in RLS policies」)。
 *
 * トリガ (0013 の custom SQL、いずれも `private` schema + SECURITY DEFINER):
 *   - `trg_review_delta` (AFTER INSERT/UPDATE/DELETE) → occurrences / events の
 *     `rating_sum` / `rating_count` へ差分反映
 *   - `trg_reviews_freeze_occurrence` (BEFORE UPDATE OF occurrence_id) →
 *     付け替え禁止 (RLS では verified 同士の付け替えを防げず集計が壊れるため)
 *   - `trg_reviews_updated_at` (BEFORE UPDATE OF rating, body, visited_on,
 *     deleted_at) → `updated_at` 自動更新。**helpful_count の増減では発火させ
 *     ない** (他人が「参考になった」を押しただけで投稿者が編集したように
 *     見えるため)
 */
export const reviews = pgTable(
  'reviews',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurrenceId: bigint('occurrence_id', { mode: 'number' })
      .notNull()
      .references(() => occurrences.id, { onDelete: 'cascade' }),
    // profiles.id = 永続 ID。退会してもレビューを残すため restrict。
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    rating: smallint('rating').notNull(),
    body: text('body'),
    visitedOn: date('visited_on'),
    // ★案 A: 「参考になった」件数の非正規化キャッシュ。列単位 GRANT で保護。
    helpfulCount: integer('helpful_count').notNull().default(0),
    // ソフトデリート。物理削除の経路は用意しない。
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 開催 1 ユーザー 1 レビュー。
    uniqueIndex('reviews_occurrence_user_uniq').on(table.occurrenceId, table.userId),
    index('reviews_occurrence_idx').on(table.occurrenceId),
    // ★ RLS 述語 + ON DELETE RESTRICT + マイページの 3 経路が依存する。
    index('reviews_user_idx').on(table.userId),
    check('reviews_rating_chk', sql`${table.rating} between 1 and 5`),
    // Layer2: DB CHECK。body は NULL or 非空白文字列 (Unicode-aware、events 継承)。
    check(
      'reviews_body_not_blank',
      sql`${table.body} is null or btrim(${table.body}, E' \t\n\r　') <> ''`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewInsert = typeof reviews.$inferInsert;
