/**
 * 口コミの値の一覧 (状態・理由・参加のしかた・金額の帯など) と上限の値。DB の CHECK と二段で固定する。
 *
 * DB の表の定義 (drizzle) を読まないファイルに分けてある。ブラウザで動く部品はここから読む
 * (`@revolution/schemas/review` を値で読むと、表の定義までブラウザに載るため)。
 * `review.ts` からも同じ物を export し直しているので、サーバー側はどちらから読んでもよい
 */

/** 星評価の下限 / 上限 (真実源)。DB CHECK `rating between 1 and 5` と二段防御。 */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** 本文の上限 (字)。DB CHECK `reviews_body_length_chk` と二段防御。 */
export const REVIEW_BODY_MAX_CHARS = 2000;

/**
 * 口コミの状態 (0018)。DB CHECK `reviews_status_chk` と一致させる。
 *
 * | 値 | 意味 |
 * |---|---|
 * | draft | 下書き (審査に回らない) |
 * | pending | 審査中 (提出・出し直し・公開後の編集の後) |
 * | published | 公開 |
 * | rejected | 差し戻し |
 * | needs_review | BOSS の確認待ち (AI が迷った・AI の審査が失敗した)。本人には審査中と同じに見せる |
 * | hidden | 非公開 (通報を受けて BOSS が非公開にした) |
 */
export const REVIEW_STATUSES = [
  'draft',
  'pending',
  'published',
  'rejected',
  'needs_review',
  'hidden',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** 審査で落とす 4 種 (ADR-0005)。個人情報・他人の顔 / 誹謗中傷・差別・性的表現 / 宣伝・スパム・開催と無関係 / グッズの譲渡・転売の呼びかけ */
export const REVIEW_SCREENING_REASONS = ['personal_info', 'abuse', 'spam', 'resale'] as const;
export type ReviewScreeningReason = (typeof REVIEW_SCREENING_REASONS)[number];

/** 状態の理由 (DB CHECK `reviews_reason_code_chk`)。通報の理由は通報のチケットで足す */
export const REVIEW_REASON_CODES = [...REVIEW_SCREENING_REASONS, 'ai_failure'] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

/** 審査の判断の記録 (review_moderation_events、0026) の主体と操作。DB の CHECK と揃える */
export const REVIEW_MODERATION_ACTORS = ['ai', 'admin'] as const;
export const REVIEW_MODERATION_ACTIONS = ['screened', 'published', 'rejected', 'requeued'] as const;

/** 参加のしかた。並ばずそのまま / 事前予約 / 整理券・当日の列 / 抽選に当選 / その他 */
export const REVIEW_ATTENDANCES = ['walk_in', 'reservation', 'queue', 'lottery', 'other'] as const;
export type ReviewAttendance = (typeof REVIEW_ATTENDANCES)[number];

/** 飲食代の帯 (1 人分)。なし / 〜¥2,000 / ¥2,000〜3,000 / ¥3,000〜5,000 / ¥5,000〜 */
export const REVIEW_FOOD_COST_BANDS = [
  'none',
  'under_2000',
  '2000_3000',
  '3000_5000',
  'over_5000',
] as const;
export type ReviewFoodCostBand = (typeof REVIEW_FOOD_COST_BANDS)[number];

/** グッズ代の帯 (1 人分)。買わなかった / 〜¥5,000 / ¥5,000〜10,000 / ¥10,000〜30,000 / ¥30,000〜 */
export const REVIEW_GOODS_COST_BANDS = [
  'none',
  'under_5000',
  '5000_10000',
  '10000_30000',
  'over_30000',
] as const;
export type ReviewGoodsCostBand = (typeof REVIEW_GOODS_COST_BANDS)[number];
