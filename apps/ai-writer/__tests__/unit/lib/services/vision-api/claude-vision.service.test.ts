/**
 * Layer 2 contract tests for ClaudeVisionService.
 *
 * Verifies the boundary between Anthropic SDK responses and Revolution-side
 * `MenuItem` / `GoodsItem` / `NoveltyItem` typed values, with focus on the
 * Templates v1.2 fields (`hasNovelty`, `noveltyCondition`, `isRandomSale`,
 * `isRandom`, `confidence`) added in Sprint 3 PR-A1.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ClaudeVisionService } from '@/lib/services/vision-api/claude-vision.service';

jest.mock('@anthropic-ai/sdk');

const MockedAnthropic = Anthropic as unknown as jest.MockedClass<typeof Anthropic>;

interface MockClaudeRawResponse {
  confidence?: number;
  menuItems?: Array<Record<string, unknown>>;
  goodsItems?: Array<Record<string, unknown>>;
  noveltyItems?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

function buildClaudeMessage(raw: MockClaudeRawResponse) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
    content: [
      {
        type: 'text',
        text: '```json\n' + JSON.stringify(raw) + '\n```',
      },
    ],
  };
}

describe('ClaudeVisionService — Layer 2 contract (Templates v1.2 fields)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;
  let service: ClaudeVisionService;
  let mockMessagesCreate: jest.Mock;

  beforeEach(() => {
    // Skip filesystem log writes by pretending production (per service implementation).
    process.env.NODE_ENV = 'production';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    mockMessagesCreate = jest.fn();
    MockedAnthropic.mockImplementation(
      () =>
        ({
          messages: { create: mockMessagesCreate },
        }) as unknown as Anthropic,
    );

    service = new ClaudeVisionService();
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
    }
  });

  describe('menu category', () => {
    it('preserves hasNovelty=true and noveltyCondition when LLM returns them', async () => {
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
          confidence: 0.92,
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
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
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
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
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
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
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
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
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
      mockMessagesCreate.mockResolvedValueOnce(
        buildClaudeMessage({
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

  describe('error handling and retry', () => {
    it('retries on transient error and succeeds on second attempt', async () => {
      mockMessagesCreate
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(
          buildClaudeMessage({
            confidence: 0.85,
            menuItems: [
              {
                name: 'コラボドリンク',
                price: 800,
                characterName: ['テストキャラ'],
                confidence: 0.85,
              },
            ],
          }),
        );

      const result = await service.extractFromImages({
        imageUrls: ['https://example.com/menu.webp'],
        prompt: 'menu prompt',
        category: 'menu',
        maxRetries: 2,
      });

      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
      expect(result.visionExtraction.menuItems).toHaveLength(1);
    });

    it('rethrows wrapped error after exhausting all retries', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('persistent network error'));

      await expect(
        service.extractFromImages({
          imageUrls: ['https://example.com/menu.webp'],
          prompt: 'menu prompt',
          category: 'menu',
          maxRetries: 2,
        }),
      ).rejects.toThrow(/Claude Vision API failed after 2 attempts/);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    });

    it('rethrows ZodError immediately without retry (deterministic shape failure)', async () => {
      // 不正な shape (confidence が範囲外 [0, 1]) を返すと
      // `VisionExtractionResultSchema.parse` の `z.number().min(0).max(1)` で reject される。
      // 注: Claude の `convertToMenuItem` (claude-vision.service.ts:461) は `name` を
      // `String(raw.name || '')` で空文字デフォルトするため `name` 欠落だけでは Zod 通過する。
      // 一方 `confidence` は `typeof raw.confidence === 'number'` の時だけ raw 値をそのまま
      // 通すため、999 のような out-of-range 値で確実に ZodError を発火できる。
      mockMessagesCreate.mockResolvedValue(
        buildClaudeMessage({
          menuItems: [
            {
              name: 'test',
              hasNovelty: false,
              characterName: [],
              confidence: 999, // out-of-range (z.number().min(0).max(1)) → ZodError
            },
          ],
        }),
      );

      await expect(
        service.extractFromImages({
          imageUrls: ['https://example.com/menu.webp'],
          prompt: 'menu prompt',
          category: 'menu',
          maxRetries: 3,
        }),
      ).rejects.toThrow();

      // ZodError は deterministic shape failure としてリトライせず即 rethrow
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });
});
