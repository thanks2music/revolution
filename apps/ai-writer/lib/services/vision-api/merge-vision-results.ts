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

export type CategoryResults = Partial<
  Record<VisionExtractionCategory, VisionExtractionResult>
>;

const FALLBACK_CONFIDENCE = 0.5;

const CATEGORIES = ['menu', 'goods', 'novelty'] as const satisfies readonly VisionExtractionCategory[];

const ITEMS_FIELD = {
  menu: 'menuItems',
  goods: 'goodsItems',
  novelty: 'noveltyItems',
} as const satisfies Record<VisionExtractionCategory, keyof VisionExtractionResult['visionExtraction']>;

function itemCount(r: VisionExtractionResult): number {
  return (
    r.visionExtraction.menuItems.length +
    r.visionExtraction.goodsItems.length +
    r.visionExtraction.noveltyItems.length
  );
}
export function mergeVisionResults(results: CategoryResults): VisionExtractionResult {
  const menuItems = results.menu?.visionExtraction.menuItems ?? [];
  const goodsItems = results.goods?.visionExtraction.goodsItems ?? [];
  const noveltyItems = results.novelty?.visionExtraction.noveltyItems ?? [];

  warnOnCrossCategoryLeakage(results);

  const allCalls = CATEGORIES
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
  let totalItems = 0;
  let weighted = 0;
  for (const r of allCalls) {
    const items = itemCount(r);
    totalItems += items;
    weighted += r.visionExtraction.confidence * items;
  }
  if (totalItems === 0) {
    // Fall back to the first call's own confidence so that a uniformly
    // low-quality extraction is not masked by FALLBACK_CONFIDENCE (0.5).
    return allCalls[0].visionExtraction.confidence ?? FALLBACK_CONFIDENCE;
  }
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
  for (const own of CATEGORIES) {
    const r = results[own];
    if (!r) continue;
    for (const other of CATEGORIES) {
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
