import {
  GoodsItemSchema,
  MenuItemSchema,
  NoveltyItemSchema,
  TokensUsedSchema,
  VisionExtractionResultSchema,
  type VisionExtractionResult,
} from '@revolution/schemas/vision-api-extraction';

describe('MenuItemSchema', () => {
  it('正常系: 必須フィールドのみ (hasNovelty/characterName) で成功', () => {
    const result = MenuItemSchema.safeParse({
      name: '五条悟のパフェ',
      characterName: ['五条悟'],
      hasNovelty: false,
    });
    expect(result.success).toBe(true);
  });

  it('正常系: v1.2 全フィールド + deprecated bonus 並存で成功', () => {
    const result = MenuItemSchema.safeParse({
      name: '五条悟のパフェ',
      price: 1200,
      characterName: ['五条悟'],
      hasNovelty: true,
      noveltyCondition: 'メニュー1品注文につき1枚ランダム配布',
      bonus: 'legacy bonus string',
      description: 'ホワイトチョコレートをベースにした甘いパフェ',
      confidence: 0.95,
    });
    expect(result.success).toBe(true);
  });

  it('異常系: hasNovelty (必須) 欠落で失敗', () => {
    const result = MenuItemSchema.safeParse({
      name: '五条悟のパフェ',
      characterName: ['五条悟'],
      // hasNovelty omitted
    });
    expect(result.success).toBe(false);
  });

  it('異常系: confidence が 1.0 超過で失敗 (Templates v1.2 範囲制約)', () => {
    const result = MenuItemSchema.safeParse({
      name: '五条悟のパフェ',
      characterName: [],
      hasNovelty: false,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('GoodsItemSchema', () => {
  it('正常系: v1.2 全フィールドで成功', () => {
    const result = GoodsItemSchema.safeParse({
      name: 'アクリルスタンド',
      price: 800,
      variantCount: 6,
      characterName: ['五条悟'],
      isRandomSale: true,
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('異常系: isRandomSale (必須) 欠落で失敗', () => {
    const result = GoodsItemSchema.safeParse({
      name: 'アクリルスタンド',
      characterName: [],
      // isRandomSale omitted
    });
    expect(result.success).toBe(false);
  });
});

describe('NoveltyItemSchema', () => {
  it('正常系: v1.2 全フィールドで成功', () => {
    const result = NoveltyItemSchema.safeParse({
      name: '描き下ろしイラストカード',
      condition: 'メニュー1品注文につき1枚ランダム配布',
      variantCount: 5,
      characterName: ['五条悟', '虎杖悠仁'],
      isRandom: true,
      confidence: 0.92,
    });
    expect(result.success).toBe(true);
  });

  it('異常系: isRandom (必須) 欠落で失敗', () => {
    const result = NoveltyItemSchema.safeParse({
      name: 'オリジナルコースター',
      characterName: [],
      // isRandom omitted
    });
    expect(result.success).toBe(false);
  });
});

describe('TokensUsedSchema', () => {
  it('正常系: 全フィールド整数値で成功', () => {
    const result = TokensUsedSchema.safeParse({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(result.success).toBe(true);
  });

  it('異常系: 負値で失敗 (nonnegative)', () => {
    const result = TokensUsedSchema.safeParse({
      promptTokens: -1,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(result.success).toBe(false);
  });
});

describe('VisionExtractionResultSchema', () => {
  function buildValid(): VisionExtractionResult {
    return {
      visionExtraction: {
        confidence: 0.9,
        provider: 'openai',
        timestamp: '2026-05-06T00:00:00.000Z',
        menuItems: [
          {
            name: 'メニュー1',
            characterName: [],
            hasNovelty: false,
          },
        ],
        goodsItems: [],
        noveltyItems: [],
        metadata: {
          hasComingSoonNotice: false,
          totalImagesAnalyzed: 1,
        },
      },
    };
  }

  it('正常系: 3 カテゴリすべて空配列でも成功', () => {
    const result = VisionExtractionResultSchema.safeParse({
      visionExtraction: {
        confidence: 0.5,
        provider: 'claude',
        timestamp: '2026-05-06T00:00:00.000Z',
        menuItems: [],
        goodsItems: [],
        noveltyItems: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('正常系: 完全な extraction で成功', () => {
    const result = VisionExtractionResultSchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('異常系: confidence が 1.0 超過で失敗', () => {
    const invalid = buildValid();
    invalid.visionExtraction.confidence = 1.5;
    const result = VisionExtractionResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('異常系: provider が enum 外で失敗', () => {
    const result = VisionExtractionResultSchema.safeParse({
      ...buildValid(),
      visionExtraction: {
        ...buildValid().visionExtraction,
        provider: 'gemini', // not in enum
      },
    });
    expect(result.success).toBe(false);
  });
});
