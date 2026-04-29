/**
 * Vision API Utility Functions
 *
 * @description
 * Utility functions for Vision API integration:
 * - Cross-check logic (HTML vs Vision API validation)
 * - Hallucination detection
 * - Fallback level selection (A/B/C)
 *
 * @package revolution
 * @module utils/vision-api-utils
 */

import type {
  VisionExtractionResult,
  FallbackLevelType,
  CrossCheckResult,
  HallucinationDetectionResult,
  VisionProvider,
  TokenCalculationResult,
} from '@/lib/types/vision-api';

/**
 * HTML Extraction Result (for cross-check)
 */
export interface HtmlExtractionData {
  /** Number of menu items extracted from HTML */
  menuItemCount: number;

  /** Number of prices extracted from HTML */
  priceCount: number;

  /** HTML sufficiency rate (0.0-1.0) */
  htmlSufficiencyRate: number;
}

/**
 * Cross-check Vision API result against HTML extraction
 *
 * @description
 * Validates Vision API extraction by comparing it with HTML extraction.
 * Detects potential hallucinations or inconsistencies.
 *
 * Detection criteria:
 * 1. "Coming Soon" notice check
 * 2. Excessive detail without HTML data
 * 3. Confidence inconsistency (high confidence but no HTML data)
 *
 * @param visionResult - Vision API extraction result
 * @param htmlExtraction - HTML extraction data
 * @returns Cross-check result with pass/fail and detected issues
 *
 * @example
 * ```typescript
 * const crossCheckResult = crossCheckVisionResult(visionResult, {
 *   menuItemCount: 0,
 *   priceCount: 0,
 *   htmlSufficiencyRate: 0.05,
 * });
 *
 * if (!crossCheckResult.passed) {
 *   console.error('Cross-check failed:', crossCheckResult.issues);
 *   // Abort article generation
 * }
 * ```
 */
export function crossCheckVisionResult(
  visionResult: VisionExtractionResult,
  htmlExtraction: HtmlExtractionData
): CrossCheckResult {
  const issues: string[] = [];
  const { visionExtraction } = visionResult;

  // Issue 1: "Coming Soon" notice detected but menu items were generated
  if (visionExtraction.metadata?.hasComingSoonNotice === true) {
    if (visionExtraction.menuItems.length > 0) {
      issues.push(
        `Hallucination detected: Generated ${visionExtraction.menuItems.length} menu items despite "Coming Soon" notice`
      );
    }
  }

  // Issue 2: No HTML data but excessive Vision API extraction
  // Note: Only flag if BOTH conditions are met:
  // 1. Extracted many items (> 10) without any HTML data
  // 2. High confidence (> 0.7) suggests possible hallucination
  // Low confidence (≤ 0.7) indicates Vision API is uncertain, which is acceptable
  if (
    htmlExtraction.menuItemCount === 0 &&
    htmlExtraction.priceCount === 0
  ) {
    if (
      visionExtraction.menuItems.length > 10 &&
      visionExtraction.confidence > 0.7
    ) {
      issues.push(
        `Suspicious: Generated ${visionExtraction.menuItems.length} menu items with high confidence (${visionExtraction.confidence.toFixed(2)}) but no HTML data`
      );
    }
  }

  // Issue 3: High confidence but no HTML data at all
  if (
    visionExtraction.confidence > 0.8 &&
    htmlExtraction.menuItemCount === 0 &&
    htmlExtraction.priceCount === 0 &&
    htmlExtraction.htmlSufficiencyRate < 0.1
  ) {
    issues.push(
      `Confidence inconsistency: High confidence (${visionExtraction.confidence.toFixed(2)}) but HTML sufficiency is very low (${(htmlExtraction.htmlSufficiencyRate * 100).toFixed(1)}%)`
    );
  }

  const passed = issues.length === 0;

  return {
    passed,
    issues,
    details: {
      htmlMenuCount: htmlExtraction.menuItemCount,
      visionMenuCount: visionExtraction.menuItems.length,
      htmlPriceCount: htmlExtraction.priceCount,
      visionPriceCount: visionExtraction.menuItems.filter((item) => item.price != null).length,
      hasComingSoonNotice: visionExtraction.metadata?.hasComingSoonNotice ?? false,
      confidenceScore: visionExtraction.confidence,
    },
  };
}

/**
 * Detect hallucination in Vision API result
 *
 * @description
 * Specialized function to detect hallucinations (false information generation).
 * This is a critical safety check to prevent publishing incorrect information.
 *
 * Hallucination types:
 * 1. Coming Soon Fabrication: Generated menu items for "Coming Soon" images
 * 2. Excessive Detail Without HTML: Generated detailed info without any HTML evidence
 * 3. Confidence Inconsistency: High confidence without supporting HTML data
 *
 * @param visionResult - Vision API extraction result
 * @param htmlExtraction - HTML extraction data
 * @returns Hallucination detection result
 *
 * @example
 * ```typescript
 * const hallucinationResult = detectHallucination(visionResult, htmlData);
 *
 * if (hallucinationResult.detected) {
 *   console.error(`[CRITICAL] Hallucination detected: ${hallucinationResult.type}`);
 *   console.error(`Reason: ${hallucinationResult.reason}`);
 *   await sendSlackNotification('critical', hallucinationResult.reason);
 *   // Abort article generation
 * }
 * ```
 */
export function detectHallucination(
  visionResult: VisionExtractionResult,
  htmlExtraction: HtmlExtractionData
): HallucinationDetectionResult {
  const { visionExtraction } = visionResult;

  // Type 1: Coming Soon Fabrication
  if (
    visionExtraction.metadata?.hasComingSoonNotice === true &&
    visionExtraction.menuItems.length > 0
  ) {
    return {
      detected: true,
      type: 'coming_soon_fabrication',
      reason: `Generated ${visionExtraction.menuItems.length} menu items for "Coming Soon" image`,
      confidence: visionExtraction.confidence,
    };
  }

  // Type 2: Excessive Detail Without HTML
  // NOTE: Only flag as hallucination if HTML sufficiency is >= 20% (above Vision API threshold).
  // When HTML sufficiency is < 20%, Vision API is the primary source and many extracted items is expected.
  if (
    htmlExtraction.menuItemCount === 0 &&
    htmlExtraction.priceCount === 0 &&
    htmlExtraction.htmlSufficiencyRate >= 0.20 &&
    visionExtraction.menuItems.length > 10
  ) {
    return {
      detected: true,
      type: 'excessive_detail_without_html',
      reason: `Generated ${visionExtraction.menuItems.length} menu items without any HTML data (HTML sufficiency: ${(htmlExtraction.htmlSufficiencyRate * 100).toFixed(1)}%)`,
      confidence: visionExtraction.confidence,
    };
  }

  // Type 3: Confidence Inconsistency
  if (
    visionExtraction.confidence > 0.85 &&
    htmlExtraction.htmlSufficiencyRate < 0.05 &&
    visionExtraction.menuItems.length > 3
  ) {
    return {
      detected: true,
      type: 'confidence_inconsistency',
      reason: `High confidence (${(visionExtraction.confidence * 100).toFixed(1)}%) but HTML sufficiency is very low (${(htmlExtraction.htmlSufficiencyRate * 100).toFixed(1)}%)`,
      confidence: visionExtraction.confidence,
    };
  }

  // No hallucination detected
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
  const { confidence, menuItems, goodsItems } = visionResult.visionExtraction;

  // Level A: Detailed extraction success (target)
  if (confidence >= 0.85 && (menuItems.length > 0 || goodsItems.length > 0)) {
    console.log(
      `[VisionApiUtils] Fallback Level A: High confidence (${confidence.toFixed(2)}) with ${menuItems.length} menu items`
    );
    return 'A';
  }

  // Level B: Partial extraction (character names only)
  if (confidence >= 0.70 && confidence < 0.85) {
    const hasCharacterName =
      menuItems.some((item) => item.characterName.length > 0) ||
      goodsItems.some((item) => item.characterName.length > 0);

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

  // Validate goods prices
  for (const item of goodsItems) {
    if (item.price != null) {
      if (item.price < 300 || item.price > 10000) {
        issues.push(
          `Goods price out of range: ${item.name} = ${item.price}円 (expected: 300-10000円)`
        );
        confidencePenalty += 0.05;
      }
    }
  }

  // Validate goods variant count
  for (const item of goodsItems) {
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

/**
 * Calculate tokens for Vision API request (provider-specific)
 *
 * @description
 * Calculates token consumption based on provider and image specifications.
 *
 * OpenAI calculation:
 * - detail=low: 85 tokens per image (fixed)
 * - detail=high: ~1,105 tokens per image (estimated based on Princess Cafe test)
 *
 * Claude calculation:
 * - tokens = (width × height) / 750
 * - Conservative estimate: 2,560 tokens per image (typical collaboration cafe menu)
 *
 * @param provider - Vision API provider ('openai' or 'claude')
 * @param imageUrls - Image URLs to analyze
 * @param detail - Detail level for OpenAI (default: 'high')
 * @returns Token calculation result with cost estimation
 *
 * @example
 * ```typescript
 * const openaiTokens = await calculateVisionTokens('openai', imageUrls, 'high');
 * console.log(`Estimated cost: $${openaiTokens.estimatedCost}`);
 *
 * const claudeTokens = await calculateVisionTokens('claude', imageUrls);
 * console.log(`Estimated cost: $${claudeTokens.estimatedCost}`);
 * ```
 */
export async function calculateVisionTokens(
  provider: VisionProvider,
  imageUrls: string[],
  detail: 'low' | 'high' | 'auto' = 'high'
): Promise<TokenCalculationResult> {
  if (provider === 'openai') {
    // OpenAI token calculation
    if (detail === 'low') {
      const imageTokens = imageUrls.length * 85;
      const promptTokens = 100; // Estimated
      const totalTokens = imageTokens + promptTokens;
      const estimatedCost = (totalTokens / 1_000_000) * 0.15; // $0.15/1M tokens

      return {
        provider: 'openai',
        totalTokens,
        breakdown: {
          imageTokens,
          promptTokens,
        },
        estimatedCost,
      };
    }

    // detail=high or auto: conservative estimate
    const imageTokens = imageUrls.length * 1105; // Based on Princess Cafe test
    const promptTokens = 100; // Estimated
    const totalTokens = imageTokens + promptTokens;
    const estimatedCost = (totalTokens / 1_000_000) * 0.15; // $0.15/1M tokens

    return {
      provider: 'openai',
      totalTokens,
      breakdown: {
        imageTokens,
        promptTokens,
      },
      estimatedCost,
    };
  } else if (provider === 'claude') {
    // Claude token calculation
    // Conservative estimate: 2,560 tokens per image (typical collaboration cafe menu)
    const imageTokens = imageUrls.length * 2560;
    const promptTokens = 100; // Estimated
    const totalTokens = imageTokens + promptTokens;
    const estimatedCost = (totalTokens / 1_000_000) * 3.0; // $3.00/1M tokens

    return {
      provider: 'claude',
      totalTokens,
      breakdown: {
        imageTokens,
        promptTokens,
      },
      estimatedCost,
    };
  }

  throw new Error(`Unknown provider: ${provider}`);
}
