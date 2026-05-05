/**
 * Layer 2 contract tests for `callVisionApiForAllCategories`.
 *
 * Verifies parallel orchestration of the Vision API across categories using a
 * mocked `IVisionApiService`, including per-category failure isolation,
 * empty-image skip behavior, and option pass-through.
 */

import {
  callVisionApiForAllCategories,
  type MultiCategoryImageMap,
} from '@/lib/services/vision-api/multi-category-vision.service';
import type {
  IVisionApiService,
  VisionApiCallOptions,
  VisionApiTemplate,
  VisionExtractionResult,
  VisionProvider,
  TokenCalculationResult,
} from '@/lib/types/vision-api';

function buildTemplate(): VisionApiTemplate {
  return {
    prompts: {
      menu_extraction: { description: 'menu', content: 'MENU' },
      goods_extraction: { description: 'goods', content: 'GOODS' },
      novelty_extraction: { description: 'novelty', content: 'NOVELTY' },
    },
  } as unknown as VisionApiTemplate;
}

function buildResult(
  category: 'menu' | 'goods' | 'novelty',
): VisionExtractionResult {
  const tagItem = (kind: string) => ({
    name: `${category}-${kind}`,
    characterName: [],
  });
  return {
    visionExtraction: {
      confidence: 0.9,
      provider: 'openai',
      timestamp: '2026-05-06T00:00:00.000Z',
      menuItems:
        category === 'menu'
          ? [{ ...tagItem('item'), hasNovelty: false }]
          : [],
      goodsItems:
        category === 'goods'
          ? [{ ...tagItem('item'), isRandomSale: false }]
          : [],
      noveltyItems:
        category === 'novelty'
          ? [{ ...tagItem('item'), isRandom: false }]
          : [],
      metadata: {
        hasComingSoonNotice: false,
        totalImagesAnalyzed: 1,
      },
    },
  };
}

interface FakeServiceCall {
  imageUrls: string[];
  category: VisionApiCallOptions['category'];
  prompt: string;
  maxRetries?: number;
  timeout?: number;
}

interface FakeServiceOptions {
  /** Per-category result/error override. Default = success returning buildResult(category). */
  responses?: Partial<
    Record<
      'menu' | 'goods' | 'novelty',
      { kind: 'success'; result?: VisionExtractionResult } | { kind: 'failure'; error: Error }
    >
  >;
}

class FakeVisionService implements IVisionApiService {
  public calls: FakeServiceCall[] = [];

  constructor(private readonly options: FakeServiceOptions = {}) {}

  async extractFromImages(
    options: VisionApiCallOptions,
  ): Promise<VisionExtractionResult> {
    this.calls.push({
      imageUrls: options.imageUrls,
      category: options.category,
      prompt: options.prompt,
      maxRetries: options.maxRetries,
      timeout: options.timeout,
    });
    const override = this.options.responses?.[options.category];
    if (override?.kind === 'failure') {
      throw override.error;
    }
    return override?.result ?? buildResult(options.category);
  }

  getProviderName(): VisionProvider {
    return 'openai';
  }

  getModelName(): string {
    return 'gpt-4o-mini';
  }

  async calculateTokens(): Promise<TokenCalculationResult> {
    return {
      provider: 'openai',
      totalTokens: 0,
      breakdown: { imageTokens: 0, promptTokens: 0 },
      estimatedCost: 0,
    };
  }
}

const TRIPLE_IMAGES: MultiCategoryImageMap = {
  menu: ['https://example.com/menu.webp'],
  goods: ['https://example.com/goods.webp'],
  novelty: ['https://example.com/novelty.webp'],
};

describe('callVisionApiForAllCategories', () => {
  it('calls all three categories in parallel and merges successful results', async () => {
    const service = new FakeVisionService();

    const { result, perCategory } = await callVisionApiForAllCategories(
      service,
      buildTemplate(),
      TRIPLE_IMAGES,
    );

    expect(service.calls).toHaveLength(3);
    expect(perCategory.menu.ok).toBe(true);
    expect(perCategory.goods.ok).toBe(true);
    expect(perCategory.novelty.ok).toBe(true);
    expect(result.visionExtraction.menuItems).toHaveLength(1);
    expect(result.visionExtraction.goodsItems).toHaveLength(1);
    expect(result.visionExtraction.noveltyItems).toHaveLength(1);
  });

  it('isolates per-category failures (menu fails, goods/novelty succeed)', async () => {
    const service = new FakeVisionService({
      responses: {
        menu: { kind: 'failure', error: new Error('menu API timeout') },
      },
    });

    const { result, perCategory } = await callVisionApiForAllCategories(
      service,
      buildTemplate(),
      TRIPLE_IMAGES,
    );

    expect(perCategory.menu.ok).toBe(false);
    expect(perCategory.menu.error).toBe('menu API timeout');
    expect(perCategory.goods.ok).toBe(true);
    expect(perCategory.novelty.ok).toBe(true);

    // Merged result excludes menu, includes goods + novelty
    expect(result.visionExtraction.menuItems).toEqual([]);
    expect(result.visionExtraction.goodsItems).toHaveLength(1);
    expect(result.visionExtraction.noveltyItems).toHaveLength(1);
  });

  it('reports all failures and returns the empty merged result when every category fails', async () => {
    const service = new FakeVisionService({
      responses: {
        menu: { kind: 'failure', error: new Error('menu fail') },
        goods: { kind: 'failure', error: new Error('goods fail') },
        novelty: { kind: 'failure', error: new Error('novelty fail') },
      },
    });

    const { result, perCategory } = await callVisionApiForAllCategories(
      service,
      buildTemplate(),
      TRIPLE_IMAGES,
    );

    expect(perCategory.menu.error).toBe('menu fail');
    expect(perCategory.goods.error).toBe('goods fail');
    expect(perCategory.novelty.error).toBe('novelty fail');
    expect(result.visionExtraction.menuItems).toEqual([]);
    expect(result.visionExtraction.goodsItems).toEqual([]);
    expect(result.visionExtraction.noveltyItems).toEqual([]);
    expect(result.visionExtraction.confidence).toBe(0.5);
  });

  it('skips API calls for categories with empty image arrays', async () => {
    const service = new FakeVisionService();
    const onlyMenu: MultiCategoryImageMap = {
      menu: ['https://example.com/menu.webp'],
      goods: [],
      novelty: [],
    };

    const { result, perCategory } = await callVisionApiForAllCategories(
      service,
      buildTemplate(),
      onlyMenu,
    );

    expect(service.calls).toHaveLength(1);
    expect(service.calls[0].category).toBe('menu');
    expect(perCategory.menu).toEqual({ ok: true });
    expect(perCategory.goods).toEqual({ ok: true, skipped: 'no images' });
    expect(perCategory.novelty).toEqual({ ok: true, skipped: 'no images' });
    expect(result.visionExtraction.menuItems).toHaveLength(1);
    expect(result.visionExtraction.goodsItems).toEqual([]);
    expect(result.visionExtraction.noveltyItems).toEqual([]);
  });

  it('makes zero API calls and returns the empty merged result when all categories are empty', async () => {
    const service = new FakeVisionService();

    const { result, perCategory } = await callVisionApiForAllCategories(
      service,
      buildTemplate(),
      { menu: [], goods: [], novelty: [] },
    );

    expect(service.calls).toHaveLength(0);
    expect(perCategory.menu.skipped).toBe('no images');
    expect(perCategory.goods.skipped).toBe('no images');
    expect(perCategory.novelty.skipped).toBe('no images');
    expect(result.visionExtraction.menuItems).toEqual([]);
    expect(result.visionExtraction.confidence).toBe(0.5);
  });

  it('forwards maxRetries and timeout options to the underlying service', async () => {
    const service = new FakeVisionService();

    await callVisionApiForAllCategories(service, buildTemplate(), TRIPLE_IMAGES, {
      maxRetries: 5,
      timeout: 12345,
    });

    for (const call of service.calls) {
      expect(call.maxRetries).toBe(5);
      expect(call.timeout).toBe(12345);
    }
  });
});
