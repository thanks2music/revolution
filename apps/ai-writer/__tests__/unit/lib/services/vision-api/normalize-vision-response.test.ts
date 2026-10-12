/**
 * Layer 1: Vision の生の応答を 3 社共通の形にそろえる `normalizeVisionResponse`。
 *
 * 2026-10-11 まで、変換は 3 社の service にばらばらにあり、`null` や `"true"` の扱い、
 * 確信度の既定値と集計が違っていた (SoT §5.3)。どの社の応答の書き方でも同じ結果になることを確かめる。
 */
import {
  averageItemConfidence,
  cleanCharacterName,
  normalizeVisionResponse,
  toBoolean,
  toOptionalNumber,
  toOptionalString,
  toPriceTaxType,
} from '@/lib/services/vision-api/normalize-vision-response';

const context = { provider: 'google' as const, totalImagesAnalyzed: 2 };

describe('値の変換', () => {
  it.each([
    ['文字列', ' パフェ ', 'パフェ'],
    ['null', null, undefined],
    ['文字列の "null"', 'null', undefined],
    ['空文字', '  ', undefined],
    ['数値', 3, undefined],
  ])('toOptionalString: %s', (_label, input, expected) => {
    expect(toOptionalString(input)).toBe(expected);
  });

  it.each([
    [true, true],
    ['true', true],
    [' TRUE ', true],
    [false, false],
    ['false', false],
    ['yes', false],
    [null, false],
    [1, false],
  ])('toBoolean(%p) は %p', (input, expected) => {
    expect(toBoolean(input)).toBe(expected);
  });

  it.each([
    [2090, 2090],
    ['2,090', 2090],
    ['1200', 1200],
    ['2,090円', undefined],
    ['0.9', undefined],
    ['約1000', undefined],
    [null, undefined],
    [Number.NaN, undefined],
  ])('toOptionalNumber(%p) は %p', (input, expected) => {
    expect(toOptionalNumber(input)).toBe(expected);
  });

  it.each([
    ['included', 'included'],
    ['税込', 'included'],
    ['excluded', 'excluded'],
    ['税抜', 'excluded'],
    ['税別', 'excluded'],
    [null, undefined],
    ['unknown', undefined],
  ])('toPriceTaxType(%p) は %p', (input, expected) => {
    expect(toPriceTaxType(input)).toBe(expected);
  });

  it('キャラクター名の装飾を落とす', () => {
    expect(cleanCharacterName('場地（制服ver）')).toBe('場地');
    expect(cleanCharacterName('千冬★')).toBe('千冬');
  });
});

describe('averageItemConfidence', () => {
  it('confidence のある品目だけを平均する', () => {
    expect(averageItemConfidence([{ confidence: 0.9 }, {}, { confidence: 0.7 }])).toBeCloseTo(0.8);
  });

  it('品目が 0、または confidence のある品目が 0 なら 0 (レベル A にしない)', () => {
    expect(averageItemConfidence([])).toBe(0);
    expect(averageItemConfidence([{}, {}])).toBe(0);
  });
});

describe('normalizeVisionResponse', () => {
  it('3 社で書き方の違う応答を、同じ形にそろえる', () => {
    // OpenAI は null、Gemini は文字列の "null"、Claude は項目の省略で「値なし」を返しがち
    const openaiStyle = {
      menuItems: [
        { name: 'パフェ', price: 1200, characterName: ['五条悟'], hasNovelty: true, noveltyCondition: null, description: null, confidence: 0.9 },
      ],
    };
    const geminiStyle = {
      menuItems: [
        { name: 'パフェ', price: '1,200', characterName: ['五条悟'], hasNovelty: 'true', noveltyCondition: 'null', description: 'null', confidence: 0.9 },
      ],
    };
    const claudeStyle = {
      confidence: 0.3,
      menuItems: [{ name: 'パフェ', price: 1200, characterName: ['五条悟'], hasNovelty: true, confidence: 0.9 }],
    };

    const results = [openaiStyle, geminiStyle, claudeStyle].map(
      (raw) => normalizeVisionResponse(raw, context).visionExtraction
    );

    for (const r of results) {
      expect(r.menuItems).toEqual([
        {
          name: 'パフェ',
          price: 1200,
          priceTaxType: undefined,
          characterName: ['五条悟'],
          hasNovelty: true,
          noveltyCondition: undefined,
          bonus: undefined,
          description: undefined,
          notes: undefined,
          remarks: undefined,
          confidence: 0.9,
        },
      ]);
      // 応答の最上位の confidence (Claude の 0.3) は使わず、品目の平均にそろえる
      expect(r.confidence).toBeCloseTo(0.9);
    }
  });

  it('name が空・無い品目は捨てる', () => {
    const result = normalizeVisionResponse(
      { goodsItems: [{ name: '' }, { price: 500 }, { name: 'null' }, { name: '缶バッジ', characterName: [] }] },
      context
    );

    expect(result.visionExtraction.goodsItems.map((g) => g.name)).toEqual(['缶バッジ']);
  });

  it('confidence の無い品目は平均から除き、0〜1 の外の値は値なしにする', () => {
    const result = normalizeVisionResponse(
      {
        noveltyItems: [
          { name: 'カード', characterName: [], confidence: 0.8 },
          { name: 'ステッカー', characterName: [] },
          { name: 'ポストカード', characterName: [], confidence: 1.5 },
        ],
      },
      context
    );

    expect(result.visionExtraction.noveltyItems[2].confidence).toBeUndefined();
    expect(result.visionExtraction.confidence).toBeCloseTo(0.8);
  });

  it('品目が 0 なら確信度は 0', () => {
    const result = normalizeVisionResponse({ menuItems: [], metadata: { hasComingSoonNotice: true } }, context);

    expect(result.visionExtraction.confidence).toBe(0);
    expect(result.visionExtraction.metadata?.hasComingSoonNotice).toBe(true);
  });

  it('税込・税抜を読む', () => {
    const result = normalizeVisionResponse(
      {
        menuItems: [
          { name: 'A', price: 2090, priceTaxType: 'included', characterName: [] },
          { name: 'B', price: 1900, priceTaxType: '税抜', characterName: [] },
          { name: 'C', price: 1000, priceTaxType: null, characterName: [] },
        ],
      },
      context
    );

    expect(result.visionExtraction.menuItems.map((m) => m.priceTaxType)).toEqual(['included', 'excluded', undefined]);
  });

  it('キャラクター名は配列だけを受け付け、文字列なら空にする', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = normalizeVisionResponse(
        {
          menuItems: [
            { name: 'A', characterName: ['五条悟★', 3, ''] },
            { name: 'B', characterName: '五条悟' },
          ],
        },
        context
      );

      expect(result.visionExtraction.menuItems[0].characterName).toEqual(['五条悟']);
      expect(result.visionExtraction.menuItems[1].characterName).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('provider・画像の枚数・トークン数を結果に載せる', () => {
    const tokensUsed = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    const result = normalizeVisionResponse({}, { provider: 'anthropic', totalImagesAnalyzed: 3, tokensUsed });

    expect(result.visionExtraction.provider).toBe('anthropic');
    expect(result.visionExtraction.metadata).toEqual({
      hasComingSoonNotice: false,
      totalImagesAnalyzed: 3,
      tokensUsed,
    });
  });

  it('応答がオブジェクトでなければ空の結果にする', () => {
    const result = normalizeVisionResponse(['unexpected'], context);

    expect(result.visionExtraction.menuItems).toEqual([]);
    expect(result.visionExtraction.confidence).toBe(0);
  });
});
