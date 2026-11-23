import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  uniqueIndex,
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
 * - `review_id` は `reviews.id` を ON DELETE cascade で参照。**親の連鎖で
 *   到達する経路は `0014` で消えた** (`reviews.occurrence_id` が restrict に
 *   なったため、レビューが残っている限り `occurrences` の削除自体が `23503`
 *   で止まる)。それでも cascade を維持するのは、**service_role が `reviews`
 *   行を直接物理削除する**経路の後始末が要るため — 重複 occurrence の整理は
 *   「レビューを先に消す」順序で service_role が実行する運用で
 *   (`reviews.ts` の occurrence_id の注記を参照)、その際に画像が孤児化する。
 *   authenticated 側は DELETE policy を持たないソフトデリート専用なので、
 *   この経路に来るのは service_role だけ。
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
 * 0021 (one-more-time #163) の変更:
 *   - 行を足すのはサーバー (service role) だけ。変換して保管側に置いた後に足す。authenticated の
 *     INSERT は取り上げた (任意の object_key を指す行を作らせない)
 *   - 読めるのは本人だけ (公開の SELECT は写真の公開と一緒に #164 で足す)
 *   - `trg_review_images_limit`: 1 つの口コミに 10 枚まで (口コミの行を押さえてから数える)
 *   - `trg_review_images_requeue`: 下書きでない口コミに写真を足したら、口コミを審査中に戻す
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
    // 変換後の寸法 (向きを直した後)。表示の時にレイアウトのずれを防ぐ (0021)
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    // 作った表示用の幅。小さい写真は大きい段を作らないので、写真ごとに違う (0021)
    variantWidths: smallint('variant_widths').array().notNull(),
    // 写真ごとの非公開 (0023、one-more-time #164)。審査で 1 枚だけ問題があった時に、口コミは公開して
    // この写真だけを出さない。理由は本人にだけ見せる。両方とも空か、両方とも入る
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenReasonCode: text('hidden_reason_code'),
    // 孤児画像回収ジョブ用。
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ★ RLS の全 policy が依存する。
    index('review_images_review_idx').on(table.reviewId),
    // 1 つの写真に 1 行 (同じ写真の取り込みが 2 回走っても、行は 1 つ。0021)
    uniqueIndex('review_images_object_key_unique').on(table.objectKey),
    // Layer2: DB CHECK。空白のみのオブジェクトキーを拒否 (Unicode-aware)。
    check(
      'review_images_object_key_not_blank',
      sql`btrim(${table.objectKey}, E' \t\n\r　') <> ''`,
    ),
    check('review_images_sort_order_chk', sql`${table.sortOrder} >= 0`),
    check('review_images_size_chk', sql`${table.width} > 0 AND ${table.height} > 0`),
    // 理由は審査の 4 種 (REVIEW_SCREENING_REASONS、shared/schemas/review.ts と揃える)
    check(
      'review_images_hidden_reason_chk',
      sql`${table.hiddenReasonCode} IS NULL OR ${table.hiddenReasonCode} IN ('personal_info', 'abuse', 'spam', 'resale')`,
    ),
    check(
      'review_images_hidden_pair_chk',
      sql`(${table.hiddenAt} IS NULL) = (${table.hiddenReasonCode} IS NULL)`,
    ),
    check(
      'review_images_variant_widths_chk',
      sql`cardinality(${table.variantWidths}) > 0 AND 0 < ALL (${table.variantWidths})`,
    ),
  ],
);

export type ReviewImageRow = typeof reviewImages.$inferSelect;
export type ReviewImageInsert = typeof reviewImages.$inferInsert;
