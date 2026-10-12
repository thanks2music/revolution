/**
 * Layer 1 unit tests for `mergeVisionResults`.
 *
 * Verifies category-attached merge, item-level confidence, metadata aggregation,
 * and cross-category leakage warnings.
 */

import { mergeVisionResults } from '@/lib/services/vision-api/merge-vision-results';
import type {
  GoodsItem,
  MenuItem,
  NoveltyItem,
  VisionExtractionResult,
} from '@/lib/types/vision-api';

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    name: 'menu-test',
    characterName: [],
    hasNovelty: false,
    ...overrides,
  };
}

function goodsItem(overrides: Partial<GoodsItem> = {}): GoodsItem {
  return {
    name: 'goods-test',
    characterName: [],
    isRandomSale: false,
    ...overrides,
  };
}

function noveltyItem(overrides: Partial<NoveltyItem> = {}): NoveltyItem {
  return {
    name: 'novelty-test',
    characterName: [],
    isRandom: false,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<VisionExtractionResult['visionExtraction']> = {},
): VisionExtractionResult {
  return {
    visionExtraction: {
      confidence: 0.9,
      provider: 'openai',
      timestamp: '2026-05-06T00:00:00.000Z',
      menuItems: [],
      goodsItems: [],
      noveltyItems: [],
      metadata: {
        hasComingSoonNotice: false,
        totalImagesAnalyzed: 1,
      },
      ...overrides,
    },
  };
}

describe('mergeVisionResults', () => {
  it('merges items from each category into the corresponding output array', () => {
    const merged = mergeVisionResults({
      menu: makeResult({ menuItems: [menuItem({ name: 'M1' })] }),
      goods: makeResult({ goodsItems: [goodsItem({ name: 'G1' })] }),
      novelty: makeResult({ noveltyItems: [noveltyItem({ name: 'N1' })] }),
    }, 'openai');

    expect(merged.visionExtraction.menuItems).toHaveLength(1);
    expect(merged.visionExtraction.menuItems[0].name).toBe('M1');
    expect(merged.visionExtraction.goodsItems).toHaveLength(1);
    expect(merged.visionExtraction.goodsItems[0].name).toBe('G1');
    expect(merged.visionExtraction.noveltyItems).toHaveLength(1);
    expect(merged.visionExtraction.noveltyItems[0].name).toBe('N1');
  });

  it('preserves only the menu category when goods/novelty are undefined', () => {
    const merged = mergeVisionResults({
      menu: makeResult({ menuItems: [menuItem()] }),
    }, 'openai');

    expect(merged.visionExtraction.menuItems).toHaveLength(1);
    expect(merged.visionExtraction.goodsItems).toEqual([]);
    expect(merged.visionExtraction.noveltyItems).toEqual([]);
  });

  it('returns an empty result with confidence 0 when input is empty (never level A)', () => {
    const merged = mergeVisionResults({}, 'openai');

    expect(merged.visionExtraction.menuItems).toEqual([]);
    expect(merged.visionExtraction.goodsItems).toEqual([]);
    expect(merged.visionExtraction.noveltyItems).toEqual([]);
    expect(merged.visionExtraction.confidence).toBe(0);
    expect(merged.visionExtraction.metadata?.totalImagesAnalyzed).toBe(0);
    expect(merged.visionExtraction.metadata?.tokensUsed).toBeUndefined();
  });

  it('averages the confidence of the adopted items, skipping items without one', () => {
    // 1 回の呼び出しの確信度と同じ規則 (averageItemConfidence): (1.0 + 1.0 + 0.4) / 3 = 0.8
    const merged = mergeVisionResults({
      menu: makeResult({
        confidence: 0.99,
        menuItems: [menuItem({ confidence: 1.0 }), menuItem({ confidence: 1.0 }), menuItem()],
      }),
      goods: makeResult({
        confidence: 0.1,
        goodsItems: [goodsItem({ confidence: 0.4 })],
      }),
    }, 'openai');

    expect(merged.visionExtraction.confidence).toBeCloseTo(0.8, 3);
  });

  it('OR-combines metadata.hasComingSoonNotice across calls', () => {
    const merged = mergeVisionResults({
      menu: makeResult({
        menuItems: [menuItem()],
        metadata: { hasComingSoonNotice: false, totalImagesAnalyzed: 1 },
      }),
      goods: makeResult({
        metadata: { hasComingSoonNotice: true, totalImagesAnalyzed: 1 },
      }),
    }, 'openai');

    expect(merged.visionExtraction.metadata?.hasComingSoonNotice).toBe(true);
  });

  it('sums tokensUsed across all calls', () => {
    const merged = mergeVisionResults({
      menu: makeResult({
        metadata: {
          hasComingSoonNotice: false,
          totalImagesAnalyzed: 1,
          tokensUsed: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      }),
      goods: makeResult({
        metadata: {
          hasComingSoonNotice: false,
          totalImagesAnalyzed: 1,
          tokensUsed: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
        },
      }),
      novelty: makeResult({
        metadata: {
          hasComingSoonNotice: false,
          totalImagesAnalyzed: 1,
          tokensUsed: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
        },
      }),
    }, 'openai');

    expect(merged.visionExtraction.metadata?.tokensUsed).toEqual({
      promptTokens: 360,
      completionTokens: 160,
      totalTokens: 520,
    });
  });

  it('sums totalImagesAnalyzed across all calls', () => {
    const merged = mergeVisionResults({
      menu: makeResult({
        metadata: { hasComingSoonNotice: false, totalImagesAnalyzed: 2 },
      }),
      goods: makeResult({
        metadata: { hasComingSoonNotice: false, totalImagesAnalyzed: 3 },
      }),
      novelty: makeResult({
        metadata: { hasComingSoonNotice: false, totalImagesAnalyzed: 1 },
      }),
    }, 'openai');

    expect(merged.visionExtraction.metadata?.totalImagesAnalyzed).toBe(6);
  });

  it('uses the provider passed by the caller and the timestamp of the first call (menu > goods > novelty)', () => {
    const merged = mergeVisionResults({
      goods: makeResult({
        provider: 'anthropic',
        timestamp: '2026-05-06T01:00:00.000Z',
      }),
      novelty: makeResult({
        provider: 'openai',
        timestamp: '2026-05-06T02:00:00.000Z',
      }),
    }, 'google');

    expect(merged.visionExtraction.provider).toBe('google');
    // goods is the first non-undefined entry in menu→goods→novelty order
    expect(merged.visionExtraction.timestamp).toBe('2026-05-06T01:00:00.000Z');
  });

  it('keeps the actual provider even when every category failed (was hardcoded to openai)', () => {
    expect(mergeVisionResults({}, 'google').visionExtraction.provider).toBe('google');
  });

  it('warns and discards cross-category leakage (menu call returning goods/novelty items)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const merged = mergeVisionResults({
        menu: makeResult({
          menuItems: [menuItem()],
          goodsItems: [goodsItem({ name: 'leaked-from-menu' })],
          noveltyItems: [noveltyItem({ name: 'leaked-from-menu' })],
        }),
      }, 'openai');

      // Leakage discarded — only menuItems[] survives.
      expect(merged.visionExtraction.menuItems).toHaveLength(1);
      expect(merged.visionExtraction.goodsItems).toEqual([]);
      expect(merged.visionExtraction.noveltyItems).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0][0]).toContain('menu call returned');
      expect(warnSpy.mock.calls[0][0]).toContain('goodsItems');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('omits metadata.tokensUsed when no call surfaces token usage', () => {
    const merged = mergeVisionResults({
      menu: makeResult({
        menuItems: [menuItem()],
        metadata: { hasComingSoonNotice: false, totalImagesAnalyzed: 1 },
        // tokensUsed intentionally undefined
      }),
    }, 'openai');

    expect(merged.visionExtraction.metadata?.tokensUsed).toBeUndefined();
  });
});
