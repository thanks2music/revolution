/**
 * Vision API 呼び出し判定のための閾値定数
 *
 * @description
 * HTML extraction の充足性を判定し、Vision API を呼び出すかどうかを決定するための閾値。
 * 各閾値は 2026-01-17 に実施した 6サイト実データ分析に基づいて決定された。
 *
 * @see データ根拠: notes/03-report/2026-01/2026-01-17-05-閾値の根拠を確立-6サイト実データ結果.md
 * @see 決定プロセス: notes/03-report/2026-01/2026-01-17-06-Action4-Step3-閾値の正式決定.md
 * @see 実装方針: notes/03-report/2026-01/2026-01-17-09-Revolution側の正式回答-Templates側提案への合意.md
 *
 * @package revolution
 * @module config/vision-api-thresholds
 */

/**
 * Vision API 呼び出し判定の閾値定数
 *
 * @constant
 * @readonly
 */
export const VISION_API_THRESHOLDS = {
  /**
   * メニュー名の最小件数
   *
   * @description
   * HTML extraction で取得したメニュー名の件数がこの値未満の場合、Vision API を呼び出す。
   *
   * @example
   * ```typescript
   * if (menuItemCount < VISION_API_THRESHOLDS.MIN_MENU_ITEM_COUNT) {
   *   // Vision API を呼び出す
   * }
   * ```
   *
   * @readonly
   * @type {number}
   *
   * データ根拠:
   * - 6サイト全てで HTML extraction は 0件（中央値 0件、平均 0件）
   * - 6サイト全てで Vision API は 6件以上取得（中央値 8.5件、平均 10.2件）
   * - 適合率: 100% (6/6サイト)
   */
  MIN_MENU_ITEM_COUNT: 3,

  /**
   * 価格情報の最小件数
   *
   * @description
   * HTML extraction で取得した価格情報の件数がこの値未満の場合、Vision API を呼び出す。
   *
   * @example
   * ```typescript
   * if (priceCount < VISION_API_THRESHOLDS.MIN_PRICE_COUNT) {
   *   // Vision API を呼び出す
   * }
   * ```
   *
   * @readonly
   * @type {number}
   *
   * データ根拠:
   * - 5/6サイトで HTML extraction は 0件、1サイトのみ 1件（中央値 0件、平均 0.17件）
   * - 6サイト全てで Vision API は 6件以上取得（中央値 8.5件、平均 9.0件）
   * - 適合率: 83.3% (5/6サイト)
   */
  MIN_PRICE_COUNT: 2,

  /**
   * HTML充足度の最小パーセンテージ
   *
   * @description
   * HTML extraction の充足度（取得できた情報の割合）がこの値未満の場合、Vision API を呼び出す。
   * 充足度は 0.0〜1.0 の範囲で表現される（例: 0.20 = 20%）。
   *
   * @example
   * ```typescript
   * const sufficiencyRate = extractedCount / totalExpectedCount;
   * if (sufficiencyRate < VISION_API_THRESHOLDS.MIN_HTML_SUFFICIENCY_RATE) {
   *   // Vision API を呼び出す
   * }
   * ```
   *
   * @readonly
   * @type {number}
   *
   * データ根拠:
   * - HTML extraction: 中央値 5%、平均 15%
   * - 5/6サイトが 20% 未満
   * - Vision API: 中央値 85%、平均 83%
   * - 適合率: 83.3% (5/6サイト)
   */
  MIN_HTML_SUFFICIENCY_RATE: 0.20, // 20%

  /**
   * Vision API呼び出しに必要な最小画像数（参考値）
   *
   * @description
   * Vision API を呼び出す際に、最低限必要な画像数の目安。
   * この値は統計データに基づく参考値であり、アラート用途に使用される。
   *
   * @example
   * ```typescript
   * if (imageCount < VISION_API_THRESHOLDS.MIN_IMAGE_COUNT) {
   *   console.warn('画像数が少ないため、Vision API の精度が低下する可能性があります');
   * }
   * ```
   *
   * @readonly
   * @type {number}
   *
   * データ根拠:
   * - 6サイトの画像数: 中央値 17枚、平均 17.7枚
   * - 最小値 3枚でも有効な抽出が可能
   * - 適合率: 100% (6/6サイト)
   */
  MIN_IMAGE_COUNT: 3,
} as const;

/**
 * Vision API 閾値の型定義
 *
 * @typedef {typeof VISION_API_THRESHOLDS} VisionApiThresholds
 */
export type VisionApiThresholds = typeof VISION_API_THRESHOLDS;

/**
 * HTML extraction の充足性チェック結果
 *
 * @interface SufficiencyCheckResult
 */
export interface SufficiencyCheckResult {
  /**
   * HTML extraction が充足しているか
   *
   * @description
   * - `true`: HTML extraction が十分であり、Vision API 呼び出し不要
   * - `false`: HTML extraction が不十分であり、Vision API 呼び出しが必要
   */
  isSufficient: boolean;

  /**
   * 判定理由（人間が読める形式）
   *
   * @example
   * "HTML extraction insufficient (menu: 0, price: 0, sufficiency: 5.0%), Vision API required"
   */
  reason: string;

  /**
   * 判定に使用した詳細データ
   */
  details: {
    /** HTML extraction で取得したメニュー名の件数 */
    menuItemCount: number;

    /** HTML extraction で取得した価格情報の件数 */
    priceCount: number;

    /** HTML extraction の充足度（0.0〜1.0） */
    htmlSufficiencyRate: number;

    /** 利用可能な画像数（任意） */
    imageCount?: number;
  };
}

/**
 * HTML extraction の充足性をチェックする
 *
 * @description
 * 提供された HTML extraction の結果から、Vision API を呼び出す必要があるかを判定する。
 * 以下のいずれかの条件を満たす場合、Vision API 呼び出しが必要と判定される:
 *
 * 1. メニュー名件数 < 3件
 * 2. 価格情報件数 < 2件
 * 3. HTML充足度 < 20%
 *
 * @param {number} menuItemCount - HTML extraction で取得したメニュー名の件数
 * @param {number} priceCount - HTML extraction で取得した価格情報の件数
 * @param {number} htmlSufficiencyRate - HTML extraction の充足度（0.0〜1.0）
 * @param {number} [imageCount] - 利用可能な画像数（任意、アラート用）
 *
 * @returns {SufficiencyCheckResult} 充足性チェックの結果
 *
 * @example
 * ```typescript
 * const result = checkExtractionSufficiency(0, 0, 0.05);
 * if (!result.isSufficient) {
 *   console.log(result.reason);
 *   // "HTML extraction insufficient (menu: 0, price: 0, sufficiency: 5.0%), Vision API required"
 *   await callVisionApi();
 * }
 * ```
 *
 * @example
 * ```typescript
 * const result = checkExtractionSufficiency(5, 5, 0.80, 15);
 * if (result.isSufficient) {
 *   console.log(result.reason);
 *   // "HTML extraction sufficient (menu: 5, price: 5, sufficiency: 80.0%)"
 *   // Vision API 呼び出しをスキップ
 * }
 * ```
 */
export function checkExtractionSufficiency(
  menuItemCount: number,
  priceCount: number,
  htmlSufficiencyRate: number,
  imageCount?: number
): SufficiencyCheckResult {
  const details = {
    menuItemCount,
    priceCount,
    htmlSufficiencyRate,
    imageCount,
  };

  // Vision API 呼び出しが必要な条件（OR条件）
  if (
    menuItemCount < VISION_API_THRESHOLDS.MIN_MENU_ITEM_COUNT ||
    priceCount < VISION_API_THRESHOLDS.MIN_PRICE_COUNT ||
    htmlSufficiencyRate < VISION_API_THRESHOLDS.MIN_HTML_SUFFICIENCY_RATE
  ) {
    return {
      isSufficient: false,
      reason: `HTML extraction insufficient (menu: ${menuItemCount}, price: ${priceCount}, sufficiency: ${(htmlSufficiencyRate * 100).toFixed(1)}%), Vision API required`,
      details,
    };
  }

  // HTML extraction が十分な場合
  return {
    isSufficient: true,
    reason: `HTML extraction sufficient (menu: ${menuItemCount}, price: ${priceCount}, sufficiency: ${(htmlSufficiencyRate * 100).toFixed(1)}%)`,
    details,
  };
}
