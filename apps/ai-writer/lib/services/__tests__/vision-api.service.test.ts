/**
 * Unit Tests for VisionApiService
 *
 * @description
 * Tests for OpenAI Vision API integration service.
 * Covers: API calls, retry logic, error handling, response parsing.
 *
 * @package revolution
 * @module services/__tests__/vision-api.service
 */

import { VisionApiService } from '../vision-api.service';
import type { VisionApiCallOptions } from '../vision-api.service';
import OpenAI from 'openai';

// Mock OpenAI client
jest.mock('openai');

describe('VisionApiService', () => {
  let service: VisionApiService;
  let mockOpenAIClient: jest.Mocked<OpenAI>;

  beforeEach(() => {
    // Reset environment
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Create service instance
    service = new VisionApiService();

    // Get mocked client
    mockOpenAIClient = (service as any).client as jest.Mocked<OpenAI>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with OPENAI_API_KEY from environment', () => {
      expect(() => new VisionApiService()).not.toThrow();
    });

    it('should throw error if OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => new VisionApiService()).toThrow(
        /OpenAI API key is required/
      );

      // Restore
      process.env.OPENAI_API_KEY = 'test-api-key';
    });

    it('should accept API key as constructor parameter', () => {
      const customService = new VisionApiService('custom-api-key');
      expect(customService).toBeDefined();
    });
  });

  describe('extractFromImages', () => {
    const mockOptions: VisionApiCallOptions = {
      imageUrls: ['https://example.com/image1.jpg'],
      prompt: 'Extract menu items from this image',
      category: 'menu',
    };

    const mockApiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              confidence: 0.9,
              menuItems: [
                {
                  name: 'テストメニュー',
                  price: 1000,
                  characterName: ['キャラクター名'],
                },
              ],
              goodsItems: [],
              noveltyItem: null,
            }),
          },
        },
      ],
    };

    beforeEach(() => {
      mockOpenAIClient.chat = {
        completions: {
          create: jest.fn().mockResolvedValue(mockApiResponse),
        },
      } as any;
    });

    it('should successfully extract data from images', async () => {
      const result = await service.extractFromImages(mockOptions);

      expect(result).toBeDefined();
      expect(result.visionExtraction).toBeDefined();
      expect(result.visionExtraction.confidence).toBe(0.9);
      expect(result.visionExtraction.provider).toBe('openai');
      expect(result.visionExtraction.menuItems).toHaveLength(1);
      expect(result.visionExtraction.menuItems[0].name).toBe('テストメニュー');
    });

    it('should use detail=low for all images (cost optimization)', async () => {
      const multiImageOptions: VisionApiCallOptions = {
        ...mockOptions,
        imageUrls: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.jpg',
          'https://example.com/image3.jpg',
        ],
      };

      await service.extractFromImages(multiImageOptions);

      const callArgs = (mockOpenAIClient.chat.completions.create as jest.Mock).mock.calls[0][0];
      const content = callArgs.messages[0].content;

      // Check all images have detail=low
      const imageUrls = content.filter((c: any) => c.type === 'image_url');
      expect(imageUrls).toHaveLength(3);
      imageUrls.forEach((img: any) => {
        expect(img.image_url.detail).toBe('low');
      });
    });

    it('should retry on failure with exponential backoff', async () => {
      // First two calls fail, third succeeds
      (mockOpenAIClient.chat.completions.create as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockResolvedValueOnce(mockApiResponse);

      const startTime = Date.now();
      const result = await service.extractFromImages({
        ...mockOptions,
        maxRetries: 3,
      });
      const elapsedTime = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledTimes(3);

      // Should have backoff delays (1s + 2s = 3000ms minimum)
      expect(elapsedTime).toBeGreaterThanOrEqual(3000);
    });

    it('should throw error after max retries exhausted', async () => {
      (mockOpenAIClient.chat.completions.create as jest.Mock)
        .mockRejectedValue(new Error('Persistent error'));

      await expect(
        service.extractFromImages({
          ...mockOptions,
          maxRetries: 2,
        })
      ).rejects.toThrow(/Vision API failed after 2 attempts/);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledTimes(2);
    });

    it('should handle timeout correctly', async () => {
      // Mock a delayed response
      (mockOpenAIClient.chat.completions.create as jest.Mock)
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockApiResponse), 5000)));

      await expect(
        service.extractFromImages({
          ...mockOptions,
          timeout: 100, // 100ms timeout
        })
      ).rejects.toThrow(/Vision API timeout after 100ms/);
    });

    it('should handle invalid JSON response', async () => {
      const invalidJsonResponse = {
        choices: [
          {
            message: {
              content: 'This is not valid JSON',
            },
          },
        ],
      };

      (mockOpenAIClient.chat.completions.create as jest.Mock)
        .mockResolvedValue(invalidJsonResponse);

      await expect(
        service.extractFromImages(mockOptions)
      ).rejects.toThrow(/Invalid JSON response from Vision API/);
    });

    it('should handle empty response', async () => {
      const emptyResponse = {
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      };

      (mockOpenAIClient.chat.completions.create as jest.Mock)
        .mockResolvedValue(emptyResponse);

      await expect(
        service.extractFromImages(mockOptions)
      ).rejects.toThrow(/Empty response from Vision API/);
    });
  });

  describe('API Request Configuration', () => {
    it('should use correct model (gpt-4o-mini)', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                confidence: 0.8,
                menuItems: [],
                goodsItems: [],
                noveltyItem: null,
              }),
            },
          },
        ],
      };

      mockOpenAIClient.chat = {
        completions: {
          create: jest.fn().mockResolvedValue(mockResponse),
        },
      } as any;

      await service.extractFromImages({
        imageUrls: ['https://example.com/test.jpg'],
        prompt: 'Test prompt',
        category: 'menu',
      });

      const callArgs = (mockOpenAIClient.chat.completions.create as jest.Mock).mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-4o-mini');
      expect(callArgs.response_format).toEqual({ type: 'json_object' });
      expect(callArgs.temperature).toBe(0.1);
      expect(callArgs.max_tokens).toBe(4096);
    });
  });
});
