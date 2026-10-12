/**
 * Vision API Utility Functions
 *
 * @description
 * Utility functions for Vision API integration:
 * - Hallucination detection (「Coming Soon」の画像から品目を作った場合)
 * - Fallback level selection (A/B/C)
 * - Business rules (価格や種類数が範囲外なら確信度を減点する)
 *
 * @package revolution
 * @module utils/vision-api-utils
 */

import type {
  VisionExtractionResult,
  FallbackLevelType,
  HallucinationDetectionResult,
} from '@/lib/types/vision-api';

/**
 * Validate that all image URLs use http(s) scheme.
 * Rejects file://, data:, javascript:, and other non-network schemes that
 * could cause opaque API errors or, in adversarial inputs, server-side
 * fetches against unintended targets (SSRF).
 *
 * Throws on the first invalid URL with an error that names the offending
 * value so callers can attribute the failure.
 *
 * @param imageUrls - Array of image URLs to validate
 * @throws {Error} when any URL is malformed or its scheme is not http(s)
 */
export function assertHttpImageUrls(imageUrls: string[]): void {
  for (const url of imageUrls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid image URL: "${url}" (not a valid URL)`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Invalid image URL scheme "${parsed.protocol}" for "${url}" (expected http or https)`
      );
    }
  }
}

/**
 * Detect hallucination in Vision API result
 *
 * @description
 * 「近日公開」「Coming Soon」の画像なのに品目を作った場合を検出する。検出したら、呼び出し側は
 * その回の Vision の結果を本文に使わない (記事は HTML の抽出だけで続ける。2026-10-11 の方針)。
 *
 * 以前は「HTML にメニューが無いのに Vision が 11 品以上」「HTML がほぼ空なのに確信度が高い」も
 * 検出して記事ごと止めていた。Vision は HTML の欠けを埋めるために呼ぶので、その 2 つは正当な
 * 場面と重なるためやめた。Vision を使うかの関門は、確信度のレベル A (`selectFallbackLevel`)。
 *
 * @param visionResult - Vision API extraction result
 * @returns Hallucination detection result
 */
export function detectHallucination(
  visionResult: VisionExtractionResult
): HallucinationDetectionResult {
  const { visionExtraction } = visionResult;

  const totalExtracted =
    visionExtraction.menuItems.length +
    visionExtraction.goodsItems.length +
    visionExtraction.noveltyItems.length;

  if (
    visionExtraction.metadata?.hasComingSoonNotice === true &&
    totalExtracted > 0
  ) {
    return {
      detected: true,
      type: 'coming_soon_fabrication',
      reason: `Generated ${totalExtracted} item(s) for "Coming Soon" image (menu=${visionExtraction.menuItems.length}, goods=${visionExtraction.goodsItems.length}, novelty=${visionExtraction.noveltyItems.length})`,
      confidence: visionExtraction.confidence,
    };
  }

  return {
    detected: false,
  };
}

/**
 * Select appropriate fallback level (A/B/C) based on Vision API result
 *
 * @description
 * Determines which fallback template to use based on extraction quality.
 *
 * Level A (Detailed): confidence >= 0.85 AND has menu/goods items
 * Level B (Partial): 0.70 <= confidence < 0.85 AND has character names
 * Level C (Generic): confidence < 0.70 OR extraction failed
 *
 * @param visionResult - Vision API extraction result
 * @returns Fallback level ('A', 'B', or 'C')
 *
 * @example
 * ```typescript
 * const fallbackLevel = selectFallbackLevel(visionResult);
 *
 * if (fallbackLevel === 'A') {
 *   // Use detailed template with menu names and prices
 *   content = generateDetailedSection(visionResult);
 * } else if (fallbackLevel === 'B') {
 *   // Use partial template with character names only
 *   content = generatePartialSection(visionResult);
 * } else {
 *   // Use generic template
 *   content = generateGenericSection();
 * }
 * ```
 */
export function selectFallbackLevel(
  visionResult: VisionExtractionResult
): FallbackLevelType {
  const { confidence, menuItems, goodsItems, noveltyItems } = visionResult.visionExtraction;

  // Level A: Detailed extraction success (target). Templates v1.2 added noveltyItems[]
  // so a novelty-only extraction (e.g. campaign-card events with no menu/goods)
  // can still reach Level A on its own.
  if (
    confidence >= 0.85 &&
    (menuItems.length > 0 || goodsItems.length > 0 || noveltyItems.length > 0)
  ) {
    console.log(
      `[VisionApiUtils] Fallback Level A: High confidence (${confidence.toFixed(2)}) with menu=${menuItems.length} goods=${goodsItems.length} novelty=${noveltyItems.length}`
    );
    return 'A';
  }

  // Level B: Partial extraction (character names only)
  if (confidence >= 0.70 && confidence < 0.85) {
    const hasCharacterName =
      menuItems.some((item) => item.characterName.length > 0) ||
      goodsItems.some((item) => item.characterName.length > 0) ||
      noveltyItems.some((item) => item.characterName.length > 0);

    if (hasCharacterName) {
      console.log(
        `[VisionApiUtils] Fallback Level B: Medium confidence (${confidence.toFixed(2)}) with character names`
      );
      return 'B';
    }
  }

  // Level C: Generic expression (minimum)
  console.log(
    `[VisionApiUtils] Fallback Level C: Low confidence (${confidence.toFixed(2)}) or insufficient data`
  );
  return 'C';
}

/**
 * Validate business rules for Vision API extraction
 *
 * @description
 * Validates extracted data against business rules (price ranges, variant counts).
 * Adjusts confidence score if violations are detected.
 *
 * Business rules (from YAML):
 * - Menu price: 500-5000 yen
 * - Goods price: 300-10000 yen
 * - Goods variant count: max 100
 * - Novelty variant count: max 50
 *
 * @param visionResult - Vision API extraction result
 * @returns Adjusted confidence score and validation issues
 *
 * @example
 * ```typescript
 * const validation = validateBusinessRules(visionResult);
 *
 * if (validation.issues.length > 0) {
 *   console.warn('Business rule violations:', validation.issues);
 *   visionResult.visionExtraction.confidence = validation.adjustedConfidence;
 * }
 * ```
 */
export function validateBusinessRules(visionResult: VisionExtractionResult): {
  adjustedConfidence: number;
  issues: string[];
} {
  const issues: string[] = [];
  let confidencePenalty = 0;

  const { menuItems, goodsItems, noveltyItems, confidence } = visionResult.visionExtraction;

  // Validate menu prices
  for (const item of menuItems) {
    if (item.price != null) {
      if (item.price < 500 || item.price > 5000) {
        issues.push(
          `Menu price out of range: ${item.name} = ${item.price}円 (expected: 500-5000円)`
        );
        confidencePenalty += 0.05;
      }
    }
  }

  for (const item of goodsItems) {
    if (item.price != null && (item.price < 300 || item.price > 10000)) {
      issues.push(
        `Goods price out of range: ${item.name} = ${item.price}円 (expected: 300-10000円)`
      );
      confidencePenalty += 0.05;
    }
    if (item.variantCount != null && item.variantCount > 100) {
      issues.push(
        `Goods variant count suspicious: ${item.name} = ${item.variantCount} variants (max: 100, likely OCR error)`
      );
      confidencePenalty += 0.1;
    }
  }

  // Validate novelty variant count
  for (const item of noveltyItems) {
    if (item.variantCount != null && item.variantCount > 50) {
      issues.push(
        `Novelty variant count suspicious: ${item.name} = ${item.variantCount} variants (max: 50)`
      );
      confidencePenalty += 0.1;
    }
  }

  // Adjust confidence (minimum: 0.0)
  const adjustedConfidence = Math.max(0, confidence - confidencePenalty);

  if (issues.length > 0) {
    console.warn(
      `[VisionApiUtils] Business rule violations detected (${issues.length} issues, penalty: -${confidencePenalty.toFixed(2)})`
    );
  }

  return {
    adjustedConfidence,
    issues,
  };
}
