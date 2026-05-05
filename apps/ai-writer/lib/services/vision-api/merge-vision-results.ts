/**
 * Vision API Multi-Category Result Merger
 *
 * @description
 * Pure function that merges per-category Vision API results (menu / goods /
 * novelty) into a single `VisionExtractionResult`. Each category contributes
 * only its own array (category-attached merge); cross-category leakage from
 * an LLM is logged as a warning but never propagated to the merged output.
 *
 * Confidence is item-count-weighted across all successful calls so a high
 * confidence on an empty category does not dominate.
 *
 * @package revolution
 * @module services/vision-api/merge-vision-results
 */
import type { VisionExtractionResult } from '@/lib/types/vision-api';
import type { VisionExtractionCategory } from './category-prompt-resolver';

export type CategoryResults = Partial<
  Record<VisionExtractionCategory, VisionExtractionResult>
>;

const FALLBACK_CONFIDENCE = 0.5;

/**
 * Merge per-category Vision API results into a single VisionExtractionResult.
 *
 * Behavior:
 * - Category-attached merge: only `results.menu.menuItems`, `results.goods.goodsItems`,
 *   `results.novelty.noveltyItems` are adopted. Cross-category leakage from an
 *   LLM is warned via console.warn and discarded.
 * - Confidence: item-count-weighted average across all successful calls.
 *   Returns FALLBACK_CONFIDENCE (0.5) when all categories are empty.
 * - Metadata: `tokensUsed` is summed; `hasComingSoonNotice` is OR-combined;
 *   `totalImagesAnalyzed` is summed.
 * - `provider` / `timestamp`: taken from the first non-undefined result in
 *   menu → goods → novelty order.
 */
export function mergeVisionResults(results: CategoryResults): VisionExtractionResult {
  const menuItems = results.menu?.visionExtraction.menuItems ?? [];
  const goodsItems = results.goods?.visionExtraction.goodsItems ?? [];
  const noveltyItems = results.novelty?.visionExtraction.noveltyItems ?? [];

  warnOnCrossCategoryLeakage(results);

  const allCalls = (['menu', 'goods', 'novelty'] as const)
    .map((c) => results[c])
    .filter((r): r is VisionExtractionResult => r !== undefined);

  const confidence = computeWeightedConfidence(allCalls);

  const metadata = mergeMetadata(allCalls);

  const first = allCalls[0];
  return {
    visionExtraction: {
      confidence,
      provider: first?.visionExtraction.provider ?? 'openai',
      timestamp: first?.visionExtraction.timestamp ?? new Date().toISOString(),
      menuItems,
      goodsItems,
      noveltyItems,
      metadata,
    },
  };
}

function computeWeightedConfidence(allCalls: VisionExtractionResult[]): number {
  if (allCalls.length === 0) {
    return FALLBACK_CONFIDENCE;
  }
  const totalItems = allCalls.reduce(
    (sum, r) =>
      sum +
      r.visionExtraction.menuItems.length +
      r.visionExtraction.goodsItems.length +
      r.visionExtraction.noveltyItems.length,
    0,
  );
  if (totalItems === 0) {
    // No items extracted across any category — fall back to the first call's
    // own confidence (which itself defaults to 0.5 when the LLM didn't
    // surface a number) so we don't mask a low-quality extraction with 0.5.
    return allCalls[0].visionExtraction.confidence ?? FALLBACK_CONFIDENCE;
  }
  const weighted = allCalls.reduce((sum, r) => {
    const items =
      r.visionExtraction.menuItems.length +
      r.visionExtraction.goodsItems.length +
      r.visionExtraction.noveltyItems.length;
    return sum + r.visionExtraction.confidence * items;
  }, 0);
  return weighted / totalItems;
}

function mergeMetadata(
  allCalls: VisionExtractionResult[],
): VisionExtractionResult['visionExtraction']['metadata'] {
  const tokensUsed = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let anyTokenUsage = false;
  let totalImagesAnalyzed = 0;
  let hasComingSoonNotice = false;

  for (const call of allCalls) {
    const m = call.visionExtraction.metadata;
    if (!m) continue;
    if (m.tokensUsed) {
      tokensUsed.promptTokens += m.tokensUsed.promptTokens;
      tokensUsed.completionTokens += m.tokensUsed.completionTokens;
      tokensUsed.totalTokens += m.tokensUsed.totalTokens;
      anyTokenUsage = true;
    }
    if (typeof m.totalImagesAnalyzed === 'number') {
      totalImagesAnalyzed += m.totalImagesAnalyzed;
    }
    if (m.hasComingSoonNotice === true) {
      hasComingSoonNotice = true;
    }
  }

  return {
    hasComingSoonNotice,
    totalImagesAnalyzed,
    ...(anyTokenUsage ? { tokensUsed } : {}),
  };
}

function warnOnCrossCategoryLeakage(results: CategoryResults): void {
  if (results.menu) {
    if (results.menu.visionExtraction.goodsItems.length > 0) {
      console.warn(
        `[mergeVisionResults] menu call returned ${results.menu.visionExtraction.goodsItems.length} goodsItems (ignored)`,
      );
    }
    if (results.menu.visionExtraction.noveltyItems.length > 0) {
      console.warn(
        `[mergeVisionResults] menu call returned ${results.menu.visionExtraction.noveltyItems.length} noveltyItems (ignored)`,
      );
    }
  }
  if (results.goods) {
    if (results.goods.visionExtraction.menuItems.length > 0) {
      console.warn(
        `[mergeVisionResults] goods call returned ${results.goods.visionExtraction.menuItems.length} menuItems (ignored)`,
      );
    }
    if (results.goods.visionExtraction.noveltyItems.length > 0) {
      console.warn(
        `[mergeVisionResults] goods call returned ${results.goods.visionExtraction.noveltyItems.length} noveltyItems (ignored)`,
      );
    }
  }
  if (results.novelty) {
    if (results.novelty.visionExtraction.menuItems.length > 0) {
      console.warn(
        `[mergeVisionResults] novelty call returned ${results.novelty.visionExtraction.menuItems.length} menuItems (ignored)`,
      );
    }
    if (results.novelty.visionExtraction.goodsItems.length > 0) {
      console.warn(
        `[mergeVisionResults] novelty call returned ${results.novelty.visionExtraction.goodsItems.length} goodsItems (ignored)`,
      );
    }
  }
}
