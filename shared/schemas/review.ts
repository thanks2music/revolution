import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { reviewHelpful } from './db/review-helpful';
import { reviewImages } from './db/review-images';
import { reviews } from './db/reviews';

/**
 * Schema-SDD 真実源: reviews + review_images + review_helpful の zod 契約 (Layer1)
 *
 * レビュー系 3 テーブルを 1 ファイルに集約する (`event.ts` が events + M:N ペアを
 * 1 file にまとめているのと同じ判断 — 3 者は常に一緒に扱われ、単独で意味を成す
 * 場面がないため)。
 *
 * - canonical 型として export するのは select 推論のみ。insert 推論型は Drizzle 側
 *   (`ReviewInsert` 等) を使う (同名 type 衝突の回避)。
 * - **`helpful_count` は insert / update の入力に含めない**。`review_helpful` の
 *   トリガ (`private.apply_review_helpful_delta`) だけが更新する派生値で、
 *   DB 側でも authenticated への UPDATE を列単位 GRANT から除外している。
 *   Layer 1 でも入口を塞いで二段防御にする。
 * - **`deleted_at` も insert には含めない**。作成直後に削除済みの行を作る用途が
 *   なく、ソフトデリートは専用の update 経路 (`ReviewSoftDeleteSchema`) で扱う。
 */

/** 星評価の下限 / 上限 (真実源)。DB CHECK `rating between 1 and 5` と二段防御。 */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** reviews 行の select スキーマ。 */
export const ReviewSchema = createSelectSchema(reviews);

/**
 * reviews の insert スキーマ。
 *
 * - occurrence_id: NOT NULL。**verified な開催であること**は RLS の with check が
 *   担保する (Layer 1 では ID の存在を検証できないため)。
 * - user_id: `profiles.id` (**永続 ID**)。`auth_user_id` ではない。
 * - rating: 1-5 の整数。
 * - body: 任意。値ありなら空白のみを拒否 (DB CHECK と二段防御)。
 * - visited_on: 任意。`z.iso.date()` (zod v4) は単純な regex と違い
 *   `2026-02-30` のような実在しない日付も拒否する
 *   (`mdx-frontmatter.ts` の `event_start_date` と同じ作法)。
 *
 * `helpful_count` / `deleted_at` は **意図的に omit** (上記 docstring 参照)。
 */
export const ReviewInsertSchema = createInsertSchema(reviews, {
  rating: z
    .number()
    .int('rating must be an integer')
    .min(REVIEW_RATING_MIN, `rating must be >= ${REVIEW_RATING_MIN}`)
    .max(REVIEW_RATING_MAX, `rating must be <= ${REVIEW_RATING_MAX}`),
  body: z.string().trim().min(1, 'body must be non-blank').nullable().optional(),
  visitedOn: z.iso.date().nullable().optional(),
}).omit({ helpfulCount: true, deletedAt: true });

/**
 * レビュー本文の更新スキーマ。**DB の列単位 GRANT と 1:1 に対応させる**
 * (`grant update (rating, body, visited_on, deleted_at)`)。
 *
 * `occurrence_id` / `user_id` / `helpful_count` を含めないのは、
 * 前 2 者が付け替え禁止 (トリガ + policy)、後者が自己インフレ防止のため。
 */
export const ReviewUpdateSchema = ReviewInsertSchema.pick({
  rating: true,
  body: true,
  visitedOn: true,
}).partial();

/**
 * ソフトデリート専用の更新スキーマ。**物理削除の経路は存在しない**
 * (reviews に DELETE policy を作っていない)。集計トリガは `deleted_at is null`
 * の行だけを有効として数えるため、ここを立てると集計から外れる。
 * `null` を渡せば復元できる。
 */
export const ReviewSoftDeleteSchema = z.object({
  deletedAt: z.date().nullable(),
});

/** review_images 行の select スキーマ。 */
export const ReviewImageSchema = createSelectSchema(reviewImages);

/**
 * review_images の insert スキーマ。
 *
 * - object_key: **R2 のオブジェクトキー**。フル URL を入れない (配信 URL は
 *   読み取り時に組み立てる)。空白のみは拒否。
 * - sort_order: 0 以上。default 0。
 */
export const ReviewImageInsertSchema = createInsertSchema(reviewImages, {
  objectKey: z.string().trim().min(1, 'object_key must be non-blank'),
  // DB 側に `default 0` があるため任意。上書きすると drizzle-zod が付ける
  // optional が外れてしまうので、明示的に付け直す。
  sortOrder: z
    .number()
    .int('sort_order must be an integer')
    .min(0, 'sort_order must be >= 0')
    .optional(),
});

/**
 * review_images の更新スキーマ。**DB の列単位 GRANT と 1:1 に対応させる**
 * (`0015` の `grant update ("sort_order")`)。
 *
 * UPDATE を許すのは並べ替えのための `sort_order` だけ。とくに `object_key` を
 * 除いているのは、書き換えられると **他人の R2 オブジェクトを自分のギャラリーに
 * 表示させられる**ため (RLS は「自分の未削除レビューに属する行か」しか見ないので
 * policy では防げない)。`review_id` は `trg_review_images_freeze_review` でも
 * 守っているが、そちらは service_role にも効かせるための多層防御で、ここは
 * authenticated 向けの入口を塞ぐ役割。
 */
export const ReviewImageUpdateSchema = ReviewImageInsertSchema.pick({
  sortOrder: true,
});

/**
 * review_helpful の insert スキーマ (「参考になった」)。
 *
 * 複合 PK `(review_id, user_id)` の重複拒否は Layer 2 のみ。
 * **UPDATE は存在しない** — トグル解除は DELETE で表現する (favorites と同じ作法)。
 */
export const ReviewHelpfulInsertSchema = createInsertSchema(reviewHelpful);

/** canonical select 型。 */
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewImage = z.infer<typeof ReviewImageSchema>;
