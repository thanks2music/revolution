/**
 * Pure merger that combines per-category Vision API results (menu / goods /
 * novelty) into a single `VisionExtractionResult`.
 *
 * - Category-attached: only each category's own array is adopted.
 *   Cross-category leakage from an LLM is logged and discarded.
 * - Confidence: 採用した品目 (各カテゴリ自身の配列) の confidence の平均。値の無い品目は
 *   除き、品目が 0 なら 0 (`averageItemConfidence`。1 回の呼び出しの確信度と同じ規則)。
 * - Metadata: `tokensUsed` summed (only when at least one call reports it),
 *   `hasComingSoonNotice` OR-combined, `totalImagesAnalyzed` summed.
 * - `provider`: 呼び出し側が渡す (全カテゴリが失敗しても実際の provider を書く)。
 * - `timestamp`: from the first non-undefined call in menu → goods → novelty order.
 */
import type {
  VisionExtractionCategory,
  VisionExtractionResult,
  VisionProvider,
} from '@/lib/types/vision-api';
import { VISION_CATEGORIES } from './category-prompt-resolver';
import { averageItemConfidence } from './normalize-vision-response';

export type CategoryResults = Partial<
  Record<VisionExtractionCategory, VisionExtractionResult>
>;

const ITEMS_FIELD = {
  menu: 'menuItems',
  goods: 'goodsItems',
  novelty: 'noveltyItems',
} as const satisfies Record<VisionExtractionCategory, keyof VisionExtractionResult['visionExtraction']>;

export function mergeVisionResults(
  results: CategoryResults,
  provider: VisionProvider,
): VisionExtractionResult {
  const menuItems = results.menu?.visionExtraction.menuItems ?? [];
  const goodsItems = results.goods?.visionExtraction.goodsItems ?? [];
  const noveltyItems = results.novelty?.visionExtraction.noveltyItems ?? [];

  warnOnCrossCategoryLeakage(results);

  const allCalls = VISION_CATEGORIES
    .map((c) => results[c])
    .filter((r): r is VisionExtractionResult => r !== undefined);

  const confidence = averageItemConfidence([...menuItems, ...goodsItems, ...noveltyItems]);

  const metadata = mergeMetadata(allCalls);

  const first = allCalls[0];
  return {
    visionExtraction: {
      confidence,
      provider,
      timestamp: first?.visionExtraction.timestamp ?? new Date().toISOString(),
      menuItems,
      goodsItems,
      noveltyItems,
      metadata,
    },
  };
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
