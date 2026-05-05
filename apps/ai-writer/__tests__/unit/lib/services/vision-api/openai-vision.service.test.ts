/**
 * Layer 2 contract tests for OpenAiVisionService.
 *
 * Verifies the boundary between OpenAI SDK responses and Revolution-side
 * `MenuItem` / `GoodsItem` / `NoveltyItem` typed values, with focus on the
 * Templates v1.2 fields (`hasNovelty`, `noveltyCondition`, `isRandomSale`,
 * `isRandom`, `confidence`) added in Sprint 3 PR-A1.
 */

import OpenAI from 'openai';
import { OpenAiVisionService } from '@/lib/services/vision-api/openai-vision.service';

jest.mock('openai');

const MockedOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;

interface MockOpenAiRawResponse {
  menuItems?: Array<Record<string, unknown>>;
  goodsItems?: Array<Record<string, unknown>>;
  noveltyItems?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

function buildOpenAiCompletion(raw: MockOpenAiRawResponse) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200 },
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify(raw),
        },
      },
    ],
  };
}

describe('OpenAiVisionService — Layer 2 contract (Templates v1.2 fields)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;
  let service: OpenAiVisionService;
  let mockChatCompletionsCreate: jest.Mock;

  beforeEach(() => {
    // Skip filesystem log writes by pretending production (per service implementation).
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'sk-test-key';

    mockChatCompletionsCreate = jest.fn();
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: { create: mockChatCompletionsCreate },
          },
        }) as unknown as OpenAI,
    );

    service = new OpenAiVisionService();
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
    }
  });

  describe('menu category', () => {
    it('preserves hasNovelty=true and noveltyCondition when LLM returns them', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          menuItems: [
            {
              name: '五条悟のパフェ',
              price: 1200,
              characterName: ['五条悟'],
              hasNovelty: true,
              noveltyCondition: 'メニュー1品注文につき1枚ランダム配布',
              confidence: 0.95,
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/menu.webp'],
        prompt: 'menu prompt',
        category: 'menu',
        maxRetries: 1,
      });

      const item = result.visionExtraction.menuItems[0];
      expect(item.hasNovelty).toBe(true);
      expect(item.noveltyCondition).toBe(
        'メニュー1品注文につき1枚ランダム配布',
      );
      expect(item.characterName).toEqual(['五条悟']);
    });

    it('defaults hasNovelty to false when LLM omits it (Templates v1.2 contract)', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          menuItems: [
            {
              name: 'コラボドリンク',
              price: 800,
              characterName: [],
              confidence: 0.88,
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/menu.webp'],
        prompt: 'menu prompt',
        category: 'menu',
        maxRetries: 1,
      });

      const item = result.visionExtraction.menuItems[0];
      expect(item.hasNovelty).toBe(false);
      expect(item.noveltyCondition).toBeUndefined();
    });
  });

  describe('goods category', () => {
    it('preserves isRandomSale=true and confidence when LLM returns them', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          goodsItems: [
            {
              name: 'アクリルスタンド',
              price: 800,
              variantCount: 6,
              characterName: ['五条悟'],
              isRandomSale: true,
              confidence: 0.9,
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/goods.webp'],
        prompt: 'goods prompt',
        category: 'goods',
        maxRetries: 1,
      });

      const item = result.visionExtraction.goodsItems[0];
      expect(item.isRandomSale).toBe(true);
      expect(item.confidence).toBeCloseTo(0.9);
      expect(item.variantCount).toBe(6);
    });

    it('defaults isRandomSale to false when LLM omits it (Templates v1.2 contract)', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          goodsItems: [
            {
              name: 'ロゴ入りトートバッグ',
              price: 2500,
              characterName: [],
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/goods.webp'],
        prompt: 'goods prompt',
        category: 'goods',
        maxRetries: 1,
      });

      const item = result.visionExtraction.goodsItems[0];
      expect(item.isRandomSale).toBe(false);
      expect(item.confidence).toBeUndefined();
    });
  });

  describe('novelty category', () => {
    it('preserves isRandom=true and confidence when LLM returns them', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          noveltyItems: [
            {
              name: '描き下ろしイラストカード',
              condition: 'メニュー1品注文につき1枚ランダム配布',
              variantCount: 5,
              characterName: ['五条悟', '虎杖悠仁'],
              isRandom: true,
              confidence: 0.92,
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/novelty.webp'],
        prompt: 'novelty prompt',
        category: 'novelty',
        maxRetries: 1,
      });

      const item = result.visionExtraction.noveltyItems[0];
      expect(item.isRandom).toBe(true);
      expect(item.confidence).toBeCloseTo(0.92);
      expect(item.variantCount).toBe(5);
      expect(item.characterName).toEqual(['五条悟', '虎杖悠仁']);
    });

    it('defaults isRandom to false when LLM omits it (Templates v1.2 contract)', async () => {
      mockChatCompletionsCreate.mockResolvedValueOnce(
        buildOpenAiCompletion({
          noveltyItems: [
            {
              name: 'オリジナルコースター',
              condition: '3,000円以上お買い上げで1枚プレゼント',
              characterName: [],
            },
          ],
        }),
      );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/novelty.webp'],
        prompt: 'novelty prompt',
        category: 'novelty',
        maxRetries: 1,
      });

      const item = result.visionExtraction.noveltyItems[0];
      expect(item.isRandom).toBe(false);
      expect(item.confidence).toBeUndefined();
    });
  });
});
