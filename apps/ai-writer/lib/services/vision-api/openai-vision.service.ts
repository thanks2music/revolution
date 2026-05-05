/**
 * OpenAI Vision API Service
 *
 * @description
 * Service for extracting menu/goods/novelty information from images using OpenAI Vision API.
 * Implements IVisionApiService interface for dual-provider architecture.
 *
 * Features:
 * - Exponential backoff retry logic (1s, 2s, 4s)
 * - Configurable detail level (low/high/auto)
 * - JSON schema validation for structured output
 * - Detailed logging with sequential file naming
 * - Token calculation and cost estimation
 *
 * @package revolution
 * @module services/vision-api/openai-vision
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import type {
  IVisionApiService,
  VisionExtractionResult,
  MenuItem,
  GoodsItem,
  NoveltyItem,
  VisionApiCallOptions,
  VisionProvider,
  TokenCalculationResult,
} from '@/lib/types/vision-api';
import { calculateCost, formatCost } from '@/lib/ai/cost';
import { assertHttpImageUrls } from '@/lib/utils/vision-api-utils';

/**
 * Raw Vision API Response (Internal Type)
 *
 * @description
 * Mirrors Templates v1.2 `output_schema.visionExtraction.{menu,goods,novelty}Items[]`.
 * v1.2 added: MenuItem.hasNovelty/noveltyCondition, GoodsItem.isRandomSale/confidence,
 * NoveltyItem.isRandom/confidence. Optional fields tolerate older or partial responses.
 */
interface RawVisionResponse {
  menuItems?: Array<{
    name: string;
    price?: number;
    characterName?: string[] | string;
    hasNovelty?: boolean;
    noveltyCondition?: string;
    bonus?: string;
    description?: string;
    notes?: string;
    remarks?: string;
    confidence?: number;
  }>;
  noveltyItems?: Array<{
    name: string;
    condition?: string;
    variantCount?: number;
    characterName?: string[] | string;
    isRandom?: boolean;
    confidence?: number;
    notes?: string;
    remarks?: string;
  }>;
  goodsItems?: Array<{
    name: string;
    price?: number;
    variantCount?: number;
    variantDetails?: string;
    characterName?: string[] | string;
    isRandomSale?: boolean;
    confidence?: number;
  }>;
  metadata?: {
    imageQuality?: string;
    hasComingSoonNotice?: boolean;
    extractionDifficulty?: string;
    totalImagesAnalyzed?: number;
  };
}

/**
 * OpenAI Vision API Configuration
 */
interface OpenAiVisionConfig {
  /** API key (optional, defaults to environment variable) */
  apiKey?: string;

  /** Detail level for image analysis (default: 'high') */
  detail?: 'low' | 'high' | 'auto';

  /** Model name override (default: 'gpt-4o-mini') */
  model?: string;
}

/**
 * OpenAI Vision API Service
 *
 * @description
 * OpenAI-specific implementation of Vision API service.
 * Uses gpt-4o-mini with configurable detail level (default: 'low' for cost).
 *
 * Token pricing (per OpenAI official docs as of 2026-04):
 * - Input: $0.15/1M tokens (gpt-4o-mini)
 * - detail=low : 85 tokens per image (fixed, 512×512 low-res representation)
 * - detail=high: base + N × (512px tile cost) — scaled to fit 2048×2048,
 *                shortest side 768px. Typically 10–20× costlier than low.
 *
 * Default = 'low' (cost-optimized). Use 'high' opt-in via VISION_API_DETAIL=high
 * env or explicit config when Japanese OCR accuracy is required.
 *
 * @example
 * ```typescript
 * const service = new OpenAiVisionService({ detail: 'high' });
 * const result = await service.extractFromImages({
 *   imageUrls: ['https://example.com/menu.jpg'],
 *   prompt: 'Extract menu items',
 *   category: 'menu'
 * });
 * ```
 */
export class OpenAiVisionService implements IVisionApiService {
  private client: OpenAI;
  private modelName: string;
  private detailLevel: 'low' | 'high' | 'auto';
  private logDir: string;

  /**
   * Constructor
   *
   * @param config - OpenAI Vision API configuration
   */
  constructor(config?: OpenAiVisionConfig) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.'
      );
    }

    this.client = new OpenAI({ apiKey });
    this.modelName = config?.model || 'gpt-4o-mini';
    // Default to 'low' (cost-optimized, ~85 tokens/image per OpenAI spec).
    // 'high' opt-in requires explicit config or VISION_API_DETAIL=high env var via Factory.
    this.detailLevel = config?.detail || 'low';

    // Log directory for non-production debug logs only
    // (Cloud Run has ephemeral FS; production relies on console.log → Cloud Logging)
    this.logDir = path.join(process.cwd(), 'logs');
    if (process.env.NODE_ENV !== 'production' && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    console.log(
      `[OpenAiVisionService] Initialized with model: ${this.modelName}, detail: ${this.detailLevel}`
    );
  }

  /**
   * Get provider name
   *
   * @returns Provider name ('openai')
   */
  getProviderName(): VisionProvider {
    return 'openai';
  }

  /**
   * Get the underlying model identifier used for API calls and cost tracking.
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Calculate tokens for image analysis
   *
   * @description
   * Estimates token count and cost for OpenAI Vision API calls.
   *
   * Token calculation (per OpenAI official spec):
   * - detail=low : 85 tokens per image (fixed, 512×512 representation)
   * - detail=high: base + N × (512px tile cost), scaled to fit 2048×2048
   *                with shortest side 768px. ~1,105 tokens/image is a rough
   *                average for typical menu photos; actual count depends on
   *                input dimensions.
   * - Prompt tokens: ~100 (rough estimate for the system+user prompt)
   *
   * @param imageUrls - Array of image URLs to analyze
   * @returns Token calculation result with cost estimation
   */
  async calculateTokens(imageUrls: string[]): Promise<TokenCalculationResult> {
    if (this.detailLevel === 'low') {
      const imageTokens = imageUrls.length * 85;
      const promptTokens = 100;
      const totalTokens = imageTokens + promptTokens;
      const estimatedCost = (totalTokens / 1_000_000) * 0.15;

      return {
        provider: 'openai',
        totalTokens,
        breakdown: {
          imageTokens,
          promptTokens,
        },
        estimatedCost,
      };
    }

    // detail=high estimate (based on 512x512 image average)
    const imageTokens = imageUrls.length * 1105;
    const promptTokens = 100;
    const totalTokens = imageTokens + promptTokens;
    const estimatedCost = (totalTokens / 1_000_000) * 0.15;

    return {
      provider: 'openai',
      totalTokens,
      breakdown: {
        imageTokens,
        promptTokens,
      },
      estimatedCost,
    };
  }

  /**
   * Extract menu/goods/novelty information from images
   *
   * @param options - Vision API call options
   * @returns Vision extraction result with menu/goods/novelty items
   */
  async extractFromImages(options: VisionApiCallOptions): Promise<VisionExtractionResult> {
    const { imageUrls, prompt, category, maxRetries = 3, timeout = 30000 } = options;

    // Defense-in-depth: reject non-http(s) URLs (file://, data:, etc.) before
    // they reach the OpenAI API to avoid opaque errors and unintended fetches.
    assertHttpImageUrls(imageUrls);

    console.log(
      `[OpenAiVisionService] Extracting ${category} from ${imageUrls.length} images (detail: ${this.detailLevel})`
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(
          `[OpenAiVisionService] Attempt ${attempt + 1}/${maxRetries} for category: ${category}`
        );

        const { raw: rawResponse, usage } = await this.callVisionApiWithTimeout(
          imageUrls,
          prompt,
          category,
          timeout
        );

        const result = this.convertToVisionExtractionResult(rawResponse, imageUrls.length, usage);

        console.log(
          `[OpenAiVisionService] ✅ Extraction successful: ${result.visionExtraction.menuItems.length} menu items, ${result.visionExtraction.noveltyItems.length} novelty items, ${result.visionExtraction.goodsItems.length} goods items`
        );

        return result;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `[OpenAiVisionService] ❌ Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`
        );

        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`[OpenAiVisionService] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // Rethrow the original error to preserve the error message pattern
    // (e.g., "Vision API call timed out after Xms")
    if (lastError) {
      throw lastError;
    }

    // This should never be reached, but for type safety
    throw new Error(
      `[OpenAiVisionService] Failed after ${maxRetries} attempts with no error captured`
    );
  }

  /**
   * Call Vision API with timeout
   */
  private async callVisionApiWithTimeout(
    imageUrls: string[],
    prompt: string,
    category: string,
    timeout: number
  ): Promise<{
    raw: RawVisionResponse;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`Vision API timeout after ${timeout}ms`)),
        timeout
      );
    });
    try {
      return await Promise.race([
        this.callVisionApi(imageUrls, prompt, category),
        timeoutPromise,
      ]);
    } finally {
      if (timerId !== undefined) clearTimeout(timerId);
    }
  }

  /**
   * Call OpenAI Vision API
   */
  private async callVisionApi(
    imageUrls: string[],
    prompt: string,
    category: string
  ): Promise<{
    raw: RawVisionResponse;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const startTime = Date.now();

    // Use the caller-provided prompt as-is (per IVisionApiService contract).
    // Callers may supply a Templates v3 YAML prompt or the interim prompt utility.
    const content: OpenAI.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: prompt,
      },
    ];

    for (const imageUrl of imageUrls) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
          detail: this.detailLevel, // Use configurable detail level
        },
      });
    }

    console.log(
      `[OpenAiVisionService] Calling OpenAI Vision API with ${imageUrls.length} images (detail: ${this.detailLevel})`
    );

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 4096,
    });

    const elapsedTime = Date.now() - startTime;

    const rawContent = response.choices[0]?.message?.content || '{}';

    // Calculate and display cost
    const cost = calculateCost(this.modelName, {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
      cachedTokens: 0, // OpenAI SDK doesn't return cached tokens separately
    });
    const costStr = formatCost(cost);
    console.log(`[OpenAiVisionService] 💰 Cost: ${costStr}`);

    // Save log with cost information
    const domain = this.extractDomain(imageUrls[0]);
    await this.saveLogToFile(
      domain,
      category,
      imageUrls,
      prompt,
      rawContent,
      response.usage,
      elapsedTime,
      cost
    );

    console.log(
      `[OpenAiVisionService] ✅ API call completed in ${elapsedTime}ms (tokens: ${response.usage?.total_tokens || 'unknown'})`
    );

    let parsed: RawVisionResponse;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error) {
      console.error('[OpenAiVisionService] Failed to parse JSON response:', rawContent);
      throw new Error(`Invalid JSON response from OpenAI Vision API: ${rawContent}`);
    }

    return {
      raw: parsed,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }

  /**
   * Convert raw response to VisionExtractionResult
   */
  private convertToVisionExtractionResult(
    raw: RawVisionResponse,
    totalImages: number,
    tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): VisionExtractionResult {
    const menuItems: MenuItem[] =
      raw.menuItems?.map((item) => this.convertToMenuItem(item)) || [];
    const goodsItems: GoodsItem[] =
      raw.goodsItems?.map((item) => this.convertToGoodsItem(item)) || [];
    const noveltyItems: NoveltyItem[] =
      raw.noveltyItems?.map((item) => this.convertToNoveltyItem(item)) || [];

    const averageConfidence =
      menuItems.length > 0
        ? menuItems.reduce((sum, item) => sum + (item.confidence || 0), 0) / menuItems.length
        : 0.5;

    return {
      visionExtraction: {
        confidence: averageConfidence,
        provider: 'openai',
        timestamp: new Date().toISOString(),
        menuItems,
        goodsItems,
        noveltyItems,
        metadata: {
          hasComingSoonNotice: raw.metadata?.hasComingSoonNotice || false,
          totalImagesAnalyzed: totalImages,
          tokensUsed,
        },
      },
    };
  }

  /**
   * Convert raw item to MenuItem
   */
  private convertToMenuItem(item: NonNullable<RawVisionResponse['menuItems']>[number]): MenuItem {
    return {
      name: item.name,
      price: item.price,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      hasNovelty: item.hasNovelty ?? false,
      noveltyCondition: item.noveltyCondition,
      bonus: item.bonus,
      description: item.description,
      notes: item.notes,
      remarks: item.remarks,
      confidence: item.confidence || 0.5,
    };
  }

  /**
   * Parse characterName field to string array
   *
   * @description
   * Expects array format from LLM. Applies minimal cleaning for robustness.
   * Legacy string format is NOT supported (development phase only).
   *
   * @param value - Raw characterName value from LLM response
   * @param itemName - Item name (menu/goods/novelty) for logging purposes
   * @returns Cleaned character names array (empty array if no characters)
   */
  private parseCharacterNameArray(value: unknown, itemName: unknown): string[] {
    // Case 1: Array (expected)
    if (Array.isArray(value)) {
      return value
        .map(v => this.cleanCharacterName(String(v)))
        .filter(v => v.length > 0);
    }

    // Case 2: Unexpected string format (should not happen in new implementation)
    if (typeof value === 'string' && value.length > 0) {
      console.warn(
        `[OpenAiVisionService] Unexpected string format for characterName: "${value}". ` +
        `Expected array format. Item name: "${itemName || 'unknown'}". ` +
        `Returning empty array.`
      );
      return [];
    }

    // Case 3: No character name or invalid
    return [];
  }

  /**
   * Clean character name (minimal decorations removal)
   *
   * @description
   * Removes common decorative symbols and parentheses.
   * Note: Assumes character names appear outside parentheses in menu names.
   *
   * Examples:
   * - "場地（制服ver）" → "場地"
   * - "千冬★" → "千冬"
   * - "マイキー♡" → "マイキー"
   *
   * @param name - Character name string
   * @returns Cleaned character name
   */
  private cleanCharacterName(name: string): string {
    return name
      // Remove decorative symbols
      .replace(/[★☆♪♡【】]/g, '')
      // Remove parentheses and their contents (e.g., "場地（制服ver）" → "場地")
      .replace(/[（(][^）)]*[）)]/g, '')
      // Trim whitespace
      .trim();
  }

  /**
   * Convert raw item to GoodsItem
   */
  private convertToGoodsItem(item: NonNullable<RawVisionResponse['goodsItems']>[number]): GoodsItem {
    return {
      name: item.name,
      price: item.price,
      variantCount: item.variantCount,
      variantDetails: item.variantDetails,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      isRandomSale: item.isRandomSale ?? false,
      confidence: item.confidence,
    };
  }

  /**
   * Convert raw item to NoveltyItem
   */
  private convertToNoveltyItem(item: NonNullable<RawVisionResponse['noveltyItems']>[number]): NoveltyItem {
    return {
      name: item.name,
      condition: item.condition,
      variantCount: item.variantCount,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      isRandom: item.isRandom ?? false,
      confidence: item.confidence,
      notes: item.notes,
      remarks: item.remarks,
    };
  }


  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Save detailed log to file
   */
  private async saveLogToFile(
    domain: string,
    category: string,
    imageUrls: string[],
    prompt: string,
    response: string,
    usage: OpenAI.CompletionUsage | undefined,
    elapsedTime: number,
    cost: { usd: number; jpy: number; breakdown: { inputCost: number; outputCost: number; cachedCost: number } }
  ): Promise<void> {
    // Skip file logging in production (Cloud Run has ephemeral filesystem;
    // logs would be lost on restart). Inline console.log/error elsewhere in
    // this file is auto-captured by Cloud Logging.
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const now = new Date();
    // JST (UTC+9) タイムスタンプ
    const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = jstDate.toISOString().split('T')[0];
    // Monotonic millisecond timestamp avoids TOCTOU + blocking readdirSync seen in
    // the previous getNextLogSequence implementation.
    const tsSuffix = now.getTime().toString();

    const filename = `${today}-VisionAPI-OpenAI-${domain.replace(/\./g, '-')}-${category}-${tsSuffix}.log`;
    const logPath = path.join(this.logDir, filename);

    const logContent = `
=================================================================
OpenAI Vision API Log - ${jstDate.toISOString().replace('Z', '+09:00')}
=================================================================

Provider: openai
Model: ${this.modelName}
Detail Level: ${this.detailLevel}
Domain: ${domain}
Category: ${category}
Timestamp: ${tsSuffix}

=================================================================
REQUEST
=================================================================

Image URLs (${imageUrls.length}):
${imageUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Prompt:
${prompt}

=================================================================
RESPONSE
=================================================================

${response}

=================================================================
METADATA
=================================================================

Elapsed Time: ${elapsedTime}ms
Total Tokens: ${usage?.total_tokens || 'unknown'}
Prompt Tokens: ${usage?.prompt_tokens || 'unknown'}
Completion Tokens: ${usage?.completion_tokens || 'unknown'}

=================================================================
COST ANALYSIS
=================================================================

Total Cost: $${cost.usd.toFixed(5)} (約¥${cost.jpy.toFixed(2)})
  - Input Cost: $${cost.breakdown.inputCost.toFixed(5)}
  - Output Cost: $${cost.breakdown.outputCost.toFixed(5)}
  - Cached Cost: $${cost.breakdown.cachedCost.toFixed(5)}

=================================================================
`;

    await fs.promises.writeFile(logPath, logContent, 'utf-8');
    console.log(`[OpenAiVisionService] Log saved: ${logPath}`);
  }
}
