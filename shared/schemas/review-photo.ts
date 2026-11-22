import { z } from 'zod';

/**
 * Schema-SDD 真実源: 口コミの写真の決まり (one-more-time #163)。
 *
 * ブラウザ (選んだその場で断る)・署名付き URL を出すサーバー・取り込みのサーバー・DB (10 枚の
 * トリガ) が同じ値を使う。DB のトリガの 10 は `review_images_max_per_review` と揃える。
 */

/** 1 つの口コミに付けられる写真の枚数 */
export const MAX_REVIEW_PHOTOS = 10;

/** 1 枚の上限 (10MB)。ブラウザで断り、署名付き URL にも長さとして入れ、取り込みでも確かめる */
export const MAX_REVIEW_PHOTO_BYTES = 10 * 1024 * 1024;
/** 画面の文に出す上限 (MB) */
export const MAX_REVIEW_PHOTO_MB = MAX_REVIEW_PHOTO_BYTES / (1024 * 1024);

/** 受け付ける形式。ブラウザが付ける Content-Type と、中身から見分けた形式の両方で確かめる */
export const REVIEW_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const;
export type ReviewPhotoType = (typeof REVIEW_PHOTO_TYPES)[number];
/** ファイルを選ぶ欄の accept (形式を付けないブラウザ向けに、HEIC の拡張子も足す) */
export const REVIEW_PHOTO_ACCEPT = [...REVIEW_PHOTO_TYPES, '.heic', '.heif'].join(',');

/**
 * 表示用に作る幅 (px)。一覧のサムネイル・本文の幅・拡大表示。元の写真がこれより小さい時は、
 * その段を作らず (拡大しない)、元の幅を一番上の段にする (`variantWidthsFor`)
 */
export const REVIEW_PHOTO_WIDTHS = [320, 720, 1440] as const;

/** 署名付き URL を求める時の入力 (ブラウザが選んだ写真の形式と大きさ) */
export const ReviewPhotoUploadRequestSchema = z.object({
  contentType: z.enum(REVIEW_PHOTO_TYPES),
  size: z.number().int().positive().max(MAX_REVIEW_PHOTO_BYTES),
});
export type ReviewPhotoUploadRequest = z.infer<typeof ReviewPhotoUploadRequestSchema>;
