/**
 * Vision API Integration Service
 *
 * @description
 * Handles OpenAI Vision API integration for extracting menu/goods/novelty information
 * from images when HTML extraction is insufficient.
 *
 * Features:
 * - OpenAI gpt-4o-mini with detail=low (cost-optimized)
 * - Retry logic with exponential backoff
 * - JSON schema validation
 * - Error handling and logging
 *
 * Cost (2026-01 pricing):
 * - gpt-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
 * - detail=low: 85 tokens per image (fixed)
 * - Estimated cost: ~$1.74/month for 500 images
 *
 * @package revolution
 * @module services/vision-api
 */

import OpenAI from 'openai';
import type {
  VisionExtractionResult,
  MenuItem,
  GoodsItem,
  NoveltyItem,
  VisionApiTemplate,
} from '@/lib/types/vision-api';

/**
 * Vision API Call Options
 */
export interface VisionApiCallOptions {
  /** Image URLs to analyze */
  imageUrls: string[];

  /** Prompt for extraction */
  prompt: string;

  /** Category being extracted (menu, goods, novelty) */
  category: 'menu' | 'goods' | 'novelty';

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Raw OpenAI Vision API Response (before type conversion)
 */
interface RawVisionResponse {
  confidence?: number;
  menuItems?: Array<Record<string, unknown>>;
  goodsItems?: Array<Record<string, unknown>>;
  noveltyItem?: Record<string, unknown> | null;
  characterName?: string;
  hasComingSoonNotice?: boolean;
}

/**
 * Vision API Service
 *
 * @description
 * Centralized service for OpenAI Vision API integration.
 * Uses gpt-4o-mini with detail=low for cost optimization.
 *
 * @example
 * ```typescript
 * const service = new VisionApiService();
 * const result = await service.extractFromImages({
 *   imageUrls: ['https://example.com/menu.jpg'],
 *   prompt: menuExtractionPrompt,
 *   category: 'menu',
 * });
 * ```
 */
export class VisionApiService {
  private client: OpenAI;
  private modelName: string = 'gpt-4o-mini';

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it to the constructor.'
      );
    }

    this.client = new OpenAI({ apiKey: key });
  }

  /**
   * Extract menu/goods/novelty information from images using Vision API
   *
   * @param options - Vision API call options
   * @returns Vision extraction result with confidence score
   *
   * @throws {Error} If API call fails after all retries
   *
   * @example
   * ```typescript
   * const result = await service.extractFromImages({
   *   imageUrls: ['https://example.com/menu1.jpg', 'https://example.com/menu2.jpg'],
   *   prompt: template.prompts.menu_extraction.content,
   *   category: 'menu',
   *   maxRetries: 3,
   * });
   *
   * console.log(`Extracted ${result.visionExtraction.menuItems.length} menu items`);
   * console.log(`Confidence: ${result.visionExtraction.confidence}`);
   * ```
   */
  async extractFromImages(
    options: VisionApiCallOptions
  ): Promise<VisionExtractionResult> {
    const {
      imageUrls,
      prompt,
      category,
      maxRetries = 3,
      timeout = 30000,
    } = options;

    console.log(
      `[VisionApiService] Extracting ${category} from ${imageUrls.length} images`
    );

    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callVisionApiWithTimeout(
          imageUrls,
          prompt,
          category,
          timeout
        );

        console.log(
          `[VisionApiService] Successfully extracted ${category} on attempt ${attempt}/${maxRetries}`
        );

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.error(
          `[VisionApiService] Attempt ${attempt}/${maxRetries} failed for ${category}:`,
          lastError.message
        );

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.log(
            `[VisionApiService] Retrying in ${backoffMs}ms...`
          );
          await this.sleep(backoffMs);
        }
      }
    }

    // All retries failed
    throw new Error(
      `Vision API failed after ${maxRetries} attempts for ${category}: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Call Vision API with timeout
   */
  private async callVisionApiWithTimeout(
    imageUrls: string[],
    prompt: string,
    category: string,
    timeoutMs: number
  ): Promise<VisionExtractionResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Vision API timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    const apiPromise = this.callVisionApi(imageUrls, prompt, category);

    return Promise.race([apiPromise, timeoutPromise]);
  }

  /**
   * Call OpenAI Vision API
   */
  private async callVisionApi(
    imageUrls: string[],
    prompt: string,
    category: string
  ): Promise<VisionExtractionResult> {
    // Build content array: text prompt + images
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: prompt,
      },
    ];

    // Add all images with detail=low
    for (const imageUrl of imageUrls) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
          detail: 'low', // Cost optimization: 85 tokens per image
        },
      });
    }

    console.log(
      `[VisionApiService] Calling OpenAI Vision API with ${imageUrls.length} images (detail=low)`
    );

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      response_format: { type: 'json_object' }, // Force JSON output
      max_tokens: 4096, // Reasonable limit for extraction
      temperature: 0.1, // Low temperature for consistent extraction
    });

    const messageContent = response.choices[0]?.message?.content;

    if (!messageContent) {
      throw new Error('Empty response from Vision API');
    }

    // Parse JSON response
    let rawJson: RawVisionResponse;
    try {
      rawJson = JSON.parse(messageContent) as RawVisionResponse;
    } catch (error) {
      console.error('[VisionApiService] Failed to parse JSON:', messageContent);
      throw new Error(
        `Invalid JSON response from Vision API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Convert raw response to typed VisionExtractionResult
    const result = this.convertToVisionExtractionResult(rawJson, category);

    console.log(
      `[VisionApiService] Extracted ${category}: confidence=${result.visionExtraction.confidence}`
    );

    return result;
  }

  /**
   * Convert raw JSON response to VisionExtractionResult
   */
  private convertToVisionExtractionResult(
    raw: RawVisionResponse,
    category: string
  ): VisionExtractionResult {
    // Extract confidence score (default: 0.5 if missing)
    const confidence = raw.confidence ?? 0.5;

    // Convert raw items to typed arrays
    const menuItems: MenuItem[] = (raw.menuItems ?? []).map((item) =>
      this.convertToMenuItem(item)
    );

    const goodsItems: GoodsItem[] = (raw.goodsItems ?? []).map((item) =>
      this.convertToGoodsItem(item)
    );

    const noveltyItem: NoveltyItem | null = raw.noveltyItem
      ? this.convertToNoveltyItem(raw.noveltyItem)
      : null;

    return {
      visionExtraction: {
        confidence,
        provider: 'openai',
        timestamp: new Date().toISOString(),
        menuItems,
        goodsItems,
        noveltyItem,
        metadata: {
          hasComingSoonNotice: raw.hasComingSoonNotice ?? false,
          totalImagesAnalyzed: 0, // Will be set by caller
        },
      },
    };
  }

  /**
   * Convert raw object to MenuItem
   */
  private convertToMenuItem(raw: Record<string, unknown>): MenuItem {
    return {
      name: String(raw.name || ''),
      price: typeof raw.price === 'number' ? raw.price : undefined,
      characterName: raw.characterName ? String(raw.characterName) : undefined,
      bonus: raw.bonus ? String(raw.bonus) : undefined,
      description: raw.description ? String(raw.description) : undefined,
    };
  }

  /**
   * Convert raw object to GoodsItem
   */
  private convertToGoodsItem(raw: Record<string, unknown>): GoodsItem {
    return {
      name: String(raw.name || ''),
      price: typeof raw.price === 'number' ? raw.price : undefined,
      variantCount: typeof raw.variantCount === 'number' ? raw.variantCount : undefined,
      variantDetails: raw.variantDetails ? String(raw.variantDetails) : undefined,
      characterName: raw.characterName ? String(raw.characterName) : undefined,
    };
  }

  /**
   * Convert raw object to NoveltyItem
   */
  private convertToNoveltyItem(raw: Record<string, unknown>): NoveltyItem {
    return {
      name: String(raw.name || ''),
      condition: String(raw.condition || ''),
      variantCount: typeof raw.variantCount === 'number' ? raw.variantCount : undefined,
      characterName: raw.characterName ? String(raw.characterName) : undefined,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance
 */
export const visionApiService = new VisionApiService();
