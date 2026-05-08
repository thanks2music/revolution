/**
 * Pure merger that combines per-category Vision API results (menu / goods /
 * novelty) into a single `VisionExtractionResult`.
 *
 * - Category-attached: only each category's own array is adopted.
 *   Cross-category leakage from an LLM is logged and discarded.
 * - Confidence: item-count-weighted across all successful calls.
 * - Metadata: `tokensUsed` summed (only when at least one call reports it),
 *   `hasComingSoonNotice` OR-combined, `totalImagesAnalyzed` summed.
 * - `provider` / `timestamp`: from the first non-undefined call in
 *   menu → goods → novelty order.
 */
import type {
  VisionExtractionCategory,
  VisionExtractionResult,
} from '@/lib/types/vision-api';
import { VISION_CATEGORIES } from './category-prompt-resolver';

export type CategoryResults = Partial<
  Record<VisionExtractionCategory, VisionExtractionResult>
>;

const FALLBACK_CONFIDENCE = 0.5;

const ITEMS_FIELD = {
  menu: 'menuItems',
  goods: 'goodsItems',
  novelty: 'noveltyItems',
} as const satisfies Record<VisionExtractionCategory, keyof VisionExtractionResult['visionExtraction']>;

export function mergeVisionResults(results: CategoryResults): VisionExtractionResult {
  const menuItems = results.menu?.visionExtraction.menuItems ?? [];
  const goodsItems = results.goods?.visionExtraction.goodsItems ?? [];
  const noveltyItems = results.novelty?.visionExtraction.noveltyItems ?? [];

  warnOnCrossCategoryLeakage(results);

  const allCalls = VISION_CATEGORIES
    .map((c) => results[c])
    .filter((r): r is VisionExtractionResult => r !== undefined);

  const confidence = computeWeightedConfidence(results);

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

function computeWeightedConfidence(results: CategoryResults): number {
  // Weight each call's confidence by the count of items it contributed in
  // its OWN category only — leaked cross-category items are discarded by
  // the merger (`warnOnCrossCategoryLeakage`) so weighting by them would
  // skew the merged confidence in proportion to noise that never reaches
  // the consumer.
  let totalItems = 0;
  let weighted = 0;
  let firstResult: VisionExtractionResult | undefined;
  for (const cat of VISION_CATEGORIES) {
    const r = results[cat];
    if (!r) continue;
    if (!firstResult) firstResult = r;
    const ownItems = (r.visionExtraction[ITEMS_FIELD[cat]] as unknown[]).length;
    totalItems += ownItems;
    weighted += r.visionExtraction.confidence * ownItems;
  }
  if (!firstResult) {
    return FALLBACK_CONFIDENCE;
  }
  if (totalItems === 0) {
    // Fall back to the first call's own confidence so that a uniformly
    // low-quality extraction is not masked by FALLBACK_CONFIDENCE (0.5).
    return firstResult.visionExtraction.confidence ?? FALLBACK_CONFIDENCE;
  }
  return weighted / totalItems;
}

function mergeMetadata(
  allCalls: VisionExtractionResult[],
): VisionExtractionResult['visionExtraction']['metadata'] {
  const tokensUsed = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
  };
  let anyTokenUsage = false;
  let anyCacheActivity = false;
  let totalImagesAnalyzed = 0;
  let hasComingSoonNotice = false;

  for (const call of allCalls) {
    const m = call.visionExtraction.metadata;
    if (!m) continue;
    if (m.tokensUsed) {
      tokensUsed.promptTokens += m.tokensUsed.promptTokens;
      tokensUsed.completionTokens += m.tokensUsed.completionTokens;
      tokensUsed.totalTokens += m.tokensUsed.totalTokens;
      if (m.tokensUsed.cachedTokens) {
        tokensUsed.cachedTokens += m.tokensUsed.cachedTokens;
        anyCacheActivity = true;
      }
      if (m.tokensUsed.cacheCreationTokens) {
        tokensUsed.cacheCreationTokens += m.tokensUsed.cacheCreationTokens;
        anyCacheActivity = true;
      }
      anyTokenUsage = true;
    }
    if (typeof m.totalImagesAnalyzed === 'number') {
      totalImagesAnalyzed += m.totalImagesAnalyzed;
    }
    if (m.hasComingSoonNotice === true) {
      hasComingSoonNotice = true;
    }
  }

  // Drop cache fields entirely when no provider reported cache activity to
  // avoid surfacing zero-valued breakdown lines for non-Anthropic calls.
  const finalTokensUsed = anyCacheActivity
    ? tokensUsed
    : {
        promptTokens: tokensUsed.promptTokens,
        completionTokens: tokensUsed.completionTokens,
        totalTokens: tokensUsed.totalTokens,
      };

  return {
    hasComingSoonNotice,
    totalImagesAnalyzed,
    ...(anyTokenUsage ? { tokensUsed: finalTokensUsed } : {}),
  };
}

function warnOnCrossCategoryLeakage(results: CategoryResults): void {
  for (const own of VISION_CATEGORIES) {
    const r = results[own];
    if (!r) continue;
    for (const other of VISION_CATEGORIES) {
      if (other === own) continue;
      const field = ITEMS_FIELD[other];
      const leaked = (r.visionExtraction[field] as unknown[]).length;
      if (leaked > 0) {
        console.warn(
          `[mergeVisionResults] ${own} call returned ${leaked} ${field} (ignored)`,
        );
      }
    }
  }
}
