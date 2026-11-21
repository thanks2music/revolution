import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
    // ★2026-08-06 cascade → restrict に変更 (claude[bot] 指摘 + BOSS 判断)。
    //   **適用は `0013` ではなく `0014`** (0013 は PR #287 の初回 push 時点で
    //   staging へ適用済みだったため、SoP §9.3 Option C-1 に従い forward
    //   migration へ切り出した。`drizzle/0014_reviews_occurrence_restrict.sql`)。
    //   cascade のままだと `DELETE FROM events` 一発で
    //   events → occurrences → reviews (→ review_images / review_helpful) と
    //   連鎖し、**ユーザー投稿のレビューと写真が物理削除される**。
    //   本テーブルは DELETE policy を持たないソフトデリート専用設計だが、
    //   親経由の CASCADE はそれを迂回してしまう。
    //   `user_id` を restrict にしているのは「退会してもレビューは残す」ため
    //   だが、守りたいものが同じである以上、occurrence 側だけ守らないのは
    //   一貫しない。レビューが付いている occurrence は RLS 上 `verified` を
    //   通った**公開済み**の開催なので、消す操作は DB 層で一度止める。
    //   ※ 重複 occurrence の整理など正当な用途は、service_role が
    //     「レビューを先に消す」順序で明示的に実行する。`occurrence_id` は
    //     trg_reviews_freeze_occurrence で付け替え不可のため、元々
    //     DELETE + 再 INSERT が想定手順 (functions.sql の同トリガ節を参照)。
    occurrenceId: bigint('occurrence_id', { mode: 'number' })
      .notNull()
      .references(() => occurrences.id, { onDelete: 'restrict' }),
    // profiles.id = 永続 ID。退会してもレビューを残すため restrict。
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    // 下書きは途中まで書けるので nullable。下書き以外では必須 (reviews_required_unless_draft_chk)
    rating: smallint('rating'),
    body: text('body'),
    visitedOn: date('visited_on'),
    // 他人に見せる訪問年月 (月初の日付)。visited_on から作る生成列 (0018)
    visitedMonth: date('visited_month').generatedAlwaysAs(
      sql`(date_trunc('month', visited_on::timestamp))::date`,
    ),
    // ★0018 (S4 口コミ)。値の一覧と意味は `shared/schemas/review.ts` の定数が正本
    // 状態。投稿者は書けず (列単位 GRANT)、投稿者の書き込みではトリガが審査中にする
    status: text('status').notNull().default('pending'),
    // 状態の理由 (審査の 4 種 / AI 審査の失敗)。reason_note は投稿者に見せる補足 (BOSS が書く)
    reasonCode: text('reason_code'),
    reasonNote: text('reason_note'),
    // AI の判断の記録 (管理画面だけで見る。投稿者には見せない)
    aiReason: text('ai_reason'),
    aiError: text('ai_error'),
    aiModel: text('ai_model'),
    aiScreenedAt: timestamp('ai_screened_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // 公開の後に内容を変えて出し直した日時 (一度でも公開後に編集した口コミだけ)
    editedAt: timestamp('edited_at', { withTimezone: true }),
    attendance: text('attendance'),
    foodCostBand: text('food_cost_band'),
    goodsCostBand: text('goods_cost_band'),
    hasSpoiler: boolean('has_spoiler').notNull().default(false),
    // ★案 A: 「参考になった」件数の非正規化キャッシュ。列単位 GRANT で保護。
    helpfulCount: integer('helpful_count').notNull().default(0),
    // ソフトデリート。物理削除の経路は用意しない。
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 開催 1 ユーザー 1 レビュー。
    // ★ 本 index の leftmost prefix が `occurrence_id` 単独の検索も賄うため、
    //   `occurrence_id` 単独の index は **置かない**。「開催のレビュー一覧」も
    //   `occurrences` 削除時の ON DELETE CASCADE も本 index で引けることを
    //   EXPLAIN で実測確認済み (2026-08-06)。reviews は最も書き込みが多くなる
    //   テーブルなので、冗長な index 1 本の維持コストがそのまま効く
    //   (`/supabase-postgres-best-practices` query-composite-indexes)。
    // ★0018: 論理削除していない行だけの部分 unique (削除の後に書き直せるように)
    uniqueIndex('reviews_occurrence_user_uniq')
      .on(table.occurrenceId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    // 開催ページの一覧 (公開中を新着順) と公開の SELECT の policy に使う (0018)
    index('reviews_occurrence_published_idx')
      .on(table.occurrenceId, table.submittedAt.desc())
      .where(sql`${table.status} = 'published' and ${table.deletedAt} is null`),
    // ★ RLS 述語 + ON DELETE RESTRICT + マイページの 3 経路が依存する。
    index('reviews_user_idx').on(table.userId),
    check('reviews_rating_chk', sql`${table.rating} between 1 and 5`),
    // 0018 の CHECK。値は `shared/schemas/review.ts` の定数と一致させる (review.test.ts が確かめる)
    check(
      'reviews_status_chk',
      sql`${table.status} in ('draft', 'pending', 'published', 'rejected', 'needs_review', 'hidden')`,
    ),
    check(
      'reviews_reason_code_chk',
      sql`${table.reasonCode} is null or ${table.reasonCode} in ('personal_info', 'abuse', 'spam', 'resale', 'ai_failure')`,
    ),
    check(
      'reviews_attendance_chk',
      sql`${table.attendance} is null or ${table.attendance} in ('walk_in', 'reservation', 'queue', 'lottery', 'other')`,
    ),
    check(
      'reviews_food_cost_band_chk',
      sql`${table.foodCostBand} is null or ${table.foodCostBand} in ('none', 'under_2000', '2000_3000', '3000_5000', 'over_5000')`,
    ),
    check(
      'reviews_goods_cost_band_chk',
      sql`${table.goodsCostBand} is null or ${table.goodsCostBand} in ('none', 'under_5000', '5000_10000', '10000_30000', 'over_30000')`,
    ),
    check('reviews_body_length_chk', sql`${table.body} is null or char_length(${table.body}) <= 2000`),
    check(
      'reviews_required_unless_draft_chk',
      sql`${table.status} = 'draft' or (${table.rating} is not null and ${table.visitedOn} is not null)`,
    ),
    // Layer2: DB CHECK。body は NULL or 非空白文字列 (Unicode-aware、events 継承)。
    check(
      'reviews_body_not_blank',
      sql`${table.body} is null or btrim(${table.body}, E' \t\n\r　') <> ''`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewInsert = typeof reviews.$inferInsert;
