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

/**
 * 口コミの通報の 8 つの理由 (仕様 #156、one-more-time #168)。最初の 4 つは審査の 4 種と同じ意味なので同じコード。
 * 個人情報・他人の顔 / 誹謗中傷・差別・性的表現 / 宣伝・スパム・開催と無関係 / グッズの譲渡・転売の呼びかけ /
 * ネタバレなのに印が無い / 写真の無断転載 / 行っていない人の口コミ / その他。
 * BOSS が通報を受けて非公開にする時の理由もこの 8 つから選ぶ
 */
export const REVIEW_REPORT_REASONS = [
  ...REVIEW_SCREENING_REASONS,
  'spoiler_unmarked',
  'photo_reposted',
  'not_attended',
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

/** プロフィール画像の通報の 5 つの理由 (仕様 #156)。画面と処理は #171 */
export const PROFILE_IMAGE_REPORT_REASONS = [
  'personal_info',
  'abuse',
  'spam',
  'photo_reposted',
  'other',
] as const;
export type ProfileImageReportReason = (typeof PROFILE_IMAGE_REPORT_REASONS)[number];

/** 通報の対象の種類 (DB CHECK `review_reports_target_type_chk`) */
export const REPORT_TARGET_TYPES = ['review', 'profile_image'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/**
 * 通報の処理の内容 (DB CHECK `review_reports_actions_chk`)。1 回の処理で複数が重なることがある
 * (ネタバレの印と写真の非公開を一緒に当てるなど)。非公開・ネタバレの印・写真の非公開・画像を外した・問題なし
 */
export const REPORT_ACTIONS = [
  'hidden',
  'spoiler_marked',
  'photo_hidden',
  'image_removed',
  'dismissed',
] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/**
 * 状態の理由 (DB CHECK `reviews_reason_code_chk`)。審査の 4 種・通報で足した 4 種・AI の審査の失敗。
 * 写真の非公開の理由 (`review_images_hidden_reason_chk`) は ai_failure を除いた通報の 8 つ
 */
export const REVIEW_REASON_CODES = [...REVIEW_REPORT_REASONS, 'ai_failure'] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

/**
 * 審査の判断の記録 (review_moderation_events、0026) の主体と操作。DB の CHECK と揃える。
 * hidden / kept / dismissed は通報の処理 (0029): 非公開にした / 直して公開のままにした / 問題なしで閉じた
 */
export const REVIEW_MODERATION_ACTORS = ['ai', 'admin'] as const;
export const REVIEW_MODERATION_ACTIONS = [
  'screened',
  'published',
  'rejected',
  'requeued',
  'hidden',
  'kept',
  'dismissed',
] as const;

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
