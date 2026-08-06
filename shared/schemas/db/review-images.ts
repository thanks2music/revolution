import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { reviews } from './reviews';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.review_images
 *
 * レビュー画像 (1 レビューに複数)。画像実体は **Cloudflare R2** に置き、本
 * テーブルはフル URL ではなく **オブジェクトキー**を保存する。配信 URL は
 * 読み取り時に組み立てる (R2 のカスタムドメイン変更に追従できるようにするため)。
 *
 * 設計判断 (S0「設計確定」、一次資料
 * `one-more-time/docs/schema/revolution-schema.ts` + `revolution-er-v3.md`):
 * - `review_id` は `reviews.id` を ON DELETE cascade で参照 (親レビューの物理
 *   削除は運用上発生しないが、`occurrences` 削除の連鎖で到達しうるため)。
 * - `object_key` は R2 のオブジェクトキー。フル URL を入れない。
 * - `sort_order` はギャラリーの並び順。UPDATE policy はこの並べ替えのために
 *   必要 (delete + insert で並べ替えると R2 のオブジェクトまで作り直しになる)。
 *   ★ authenticated への UPDATE は **`sort_order` の列単位 GRANT** に絞っている
 *   (`0015`)。テーブル単位だと `object_key` を任意の R2 キーへ書き換えられ、
 *   **他人の写真を自分のギャラリーに表示させられる** (RLS は「自分の未削除
 *   レビューに属する行か」しか見ないため policy では防げない)。
 *   `reviews.helpful_count` を列単位 GRANT で守っているのと同じ理屈。
 * - `created_at` は **孤児画像回収ジョブ**が使う (presigned URL で先にアップ
 *   ロードされたが行が作られなかったオブジェクトの検出)。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK):
 *   object_key:
 *     Layer1 = zod (`shared/schemas/review-image.ts`、`.min(1)`)
 *     Layer2 = DB CHECK (`btrim(..., E' \t\n\r　') <> ''`、Unicode-aware)
 *   sort_order:
 *     Layer2 = DB CHECK (`sort_order >= 0`)
 *
 * ★ `review_images_review_idx` は RLS の全 policy が `review_id in (select ...)`
 *   で依存するため必須 (Supabase 公式 security-rls-performance)。
 *
 * トリガ (0013 の custom SQL):
 *   - `trg_review_images_freeze_review` (BEFORE UPDATE OF review_id) →
 *     付け替え禁止。RLS だけでは「**自分が所有する別のアクティブなレビュー**へ
 *     の付け替え」を防げない (using / with check は「自分の未削除レビューに
 *     属するか」しか見ないため A も B も自分のものなら両方通過する)。
 *     集計キャッシュには影響しないが、**写真は特定の開催で撮られたもの**であり
 *     別開催のレビューに移せると「会場 X の写真が会場 Y のレビューに並ぶ」
 *     誤表示になる。
 */
export const reviewImages = pgTable(
  'review_images',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    reviewId: bigint('review_id', { mode: 'number' })
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    // R2 オブジェクトキー (フル URL ではない)。
    objectKey: text('object_key').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    // 孤児画像回収ジョブ用。
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ★ RLS の全 policy が依存する。
    index('review_images_review_idx').on(table.reviewId),
    // Layer2: DB CHECK。空白のみのオブジェクトキーを拒否 (Unicode-aware)。
    check(
      'review_images_object_key_not_blank',
      sql`btrim(${table.objectKey}, E' \t\n\r　') <> ''`,
    ),
    check('review_images_sort_order_chk', sql`${table.sortOrder} >= 0`),
  ],
);

export type ReviewImageRow = typeof reviewImages.$inferSelect;
export type ReviewImageInsert = typeof reviewImages.$inferInsert;
