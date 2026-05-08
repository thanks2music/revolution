/**
 * Claude Vision API Service
 *
 * @description
 * Claude Vision API (Sonnet 4.5) implementation.
 *
 * Cost (2026-01 pricing):
 * - Sonnet 4.5: $3.00/1M input tokens, $15.00/1M output tokens
 * - Token calculation: (width × height) / 750
 *
 * Advantages over OpenAI:
 * - No explicit Japanese language limitations
 * - Native URL image input (no base64 needed)
 * - Max 100 images per request
 *
 * @package revolution
 * @module services/vision-api/claude
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import type {
  IVisionApiService,
  VisionApiCallOptions,
  VisionExtractionResult,
  VisionProvider,
  TokenCalculationResult,
  MenuItem,
  GoodsItem,
  NoveltyItem,
} from '@/lib/types/vision-api';
import { VisionExtractionResultSchema } from '@revolution/schemas/vision-api-extraction';
import { calculateCost, formatCost, type CostResult } from '@/lib/ai/cost';
import { assertHttpImageUrls } from '@/lib/utils/vision-api-utils';

interface RawClaudeResponse {
  confidence?: number;
  menuItems?: Array<Record<string, unknown>>;
  goodsItems?: Array<Record<string, unknown>>;
  noveltyItems?: Array<Record<string, unknown>>;
  metadata?: {
    imageQuality?: string;
    hasComingSoonNotice?: boolean;
    extractionDifficulty?: string;
  };
}

export class ClaudeVisionService implements IVisionApiService {
  private client: Anthropic;
  private modelName: string = 'claude-sonnet-4-5-20250929';
  private logDir: string;

  constructor(config?: { apiKey?: string }) {
    const key = config?.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!key) {
      throw new Error(
        'Claude API key is required. Set ANTHROPIC_API_KEY environment variable or pass it to the constructor.'
      );
    }

    this.client = new Anthropic({ apiKey: key });

    // Log directory for non-production debug logs only
    // (Cloud Run has ephemeral FS; production relies on console.log → Cloud Logging)
    this.logDir = path.join(process.cwd(), 'logs');
    if (process.env.NODE_ENV !== 'production' && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): VisionProvider {
    return 'claude';
  }

  /**
   * Get the underlying model identifier used for API calls and cost tracking.
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Calculate tokens for Claude Vision API
   *
   * @description
   * Token calculation for Claude Vision:
   * tokens = (width × height) / 750
   *
   * Note: We cannot calculate exact tokens without fetching image dimensions.
   * Use conservative estimate based on Princess Cafe images:
   * - Food menu: 1200x1600 = 2,560 tokens
   * - Drink menu: 1200x1600 = 2,560 tokens
   * - Average: 2,560 tokens per image
   *
   * @param imageUrls - Image URLs to analyze
   * @returns Token calculation result
   */
  async calculateTokens(imageUrls: string[]): Promise<TokenCalculationResult> {
    // Conservative estimate: 2,560 tokens per image (based on typical collaboration cafe menu images)
    const imageTokens = imageUrls.length * 2560;
    const promptTokens = 100; // Estimated
    const totalTokens = imageTokens + promptTokens;
    const estimatedCost = (totalTokens / 1_000_000) * 3.0; // $3.00/1M tokens

    return {
      provider: 'claude',
      totalTokens,
      breakdown: {
        imageTokens,
        promptTokens,
      },
      estimatedCost,
    };
  }

  /**
   * Extract from images using Claude Vision API
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

    // Defense-in-depth: reject non-http(s) URLs (file://, data:, etc.) before
    // they reach the Anthropic API to avoid opaque errors and unintended fetches.
    assertHttpImageUrls(imageUrls);

    console.log(
      `[ClaudeVisionService] Extracting ${category} from ${imageUrls.length} images`
    );

    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callClaudeVisionApiWithTimeout(
          imageUrls,
          prompt,
          category,
          timeout
        );

        console.log(
          `[ClaudeVisionService] Successfully extracted ${category} on attempt ${attempt}/${maxRetries}`
        );

        return result;
      } catch (error) {
        // ZodError from `VisionExtractionResultSchema.parse` (boundary validation)
        // is a deterministic shape mismatch — re-throw without retry so the bug
        // surfaces immediately instead of consuming three retries' worth of
        // tokens for the same failure.
        if (error instanceof ZodError) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));

        console.error(
          `[ClaudeVisionService] Attempt ${attempt}/${maxRetries} failed for ${category}:`,
          lastError.message
        );

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.log(
            `[ClaudeVisionService] Retrying in ${backoffMs}ms...`
          );
          await this.sleep(backoffMs);
        }
      }
    }

    // All retries failed
    throw new Error(
      `Claude Vision API failed after ${maxRetries} attempts for ${category}: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Call Claude Vision API with timeout
   */
  private async callClaudeVisionApiWithTimeout(
    imageUrls: string[],
    prompt: string,
    category: string,
    timeoutMs: number
  ): Promise<VisionExtractionResult> {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`Claude Vision API timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    const apiPromise = this.callClaudeVisionApi(imageUrls, prompt, category);

    try {
      return await Promise.race([apiPromise, timeoutPromise]);
    } finally {
      if (timerId !== undefined) clearTimeout(timerId);
    }
  }

  /**
   * Call Claude Vision API
   */
  private async callClaudeVisionApi(
    imageUrls: string[],
    prompt: string,
    category: string
  ): Promise<VisionExtractionResult> {
    // Build content array: cached static prompt first, then per-article images.
    //
    // Anthropic prompt cache uses prefix caching — `cache_control` on a block
    // marks everything from the start of the message up to and including that
    // block as cacheable. Putting the static text prompt at content[0] (with
    // a 5m TTL ephemeral breakpoint) keeps the per-article images outside the
    // cache prefix so cache hits are not invalidated when the image set
    // changes between calls. With 3 categories called in parallel via
    // `callVisionApiForAllCategories`, the first call writes the cache (1.25x
    // base) and the remaining two read it (0.1x base), turning the strategy
    // black on the very first reuse.
    const content: Anthropic.Messages.MessageParam['content'] = [
      {
        type: 'text',
        text: prompt,
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
    ];

    // Add all images after the cached prompt block
    for (const imageUrl of imageUrls) {
      content.push({
        type: 'image',
        source: {
          type: 'url',
          url: imageUrl,
        },
      });
    }

    console.log(
      `[ClaudeVisionService] Calling Claude Vision API with ${imageUrls.length} images`
    );

    const isDebug = process.env.DEBUG_VISION_API === 'true';

    let response;
    try {
      if (isDebug) {
        console.log('[ClaudeVisionService] Content structure:', JSON.stringify(content, null, 2));
      }
      response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: 4096, // Reasonable limit for extraction
        temperature: 0.1, // Low temperature for consistent extraction
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });
      console.log('[ClaudeVisionService] API call completed successfully');
    } catch (apiError) {
      console.error('[ClaudeVisionService] API call failed:', apiError);
      throw apiError;
    }

    // Calculate and display cost. Anthropic returns cache activity as separate
    // fields on `usage`; both may be `null` when no cache breakpoint was used.
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
    const cachedTokens = response.usage.cache_read_input_tokens ?? 0;
    const cost = calculateCost(this.modelName, {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      cachedTokens,
      cacheCreationTokens,
    });
    const costStr = formatCost(cost);
    console.log(`[ClaudeVisionService] 💰 Cost: ${costStr}`);

    if (isDebug) {
      console.log('[ClaudeVisionService] Raw response object:', JSON.stringify(response, null, 2));
      console.log('[ClaudeVisionService] Response type:', typeof response);
      console.log('[ClaudeVisionService] Response has content?:', response && 'content' in response);
    }

    if (!response || !response.content) {
      throw new Error(`Invalid response from Claude API: response=${!!response}, content=${!!(response?.content)}`);
    }

    if (isDebug) {
      console.log('[ClaudeVisionService] Response content blocks:', response.content.length);
      console.log('[ClaudeVisionService] Response content types:', response.content.map((block) => block.type));
    }

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      console.error('[ClaudeVisionService] Response content:', JSON.stringify(response.content, null, 2));
      throw new Error('No text content in Claude Vision API response');
    }

    const messageContent = textContent.text;

    if (!messageContent) {
      throw new Error('Empty response from Claude Vision API');
    }

    // Parse JSON response
    let rawJson: RawClaudeResponse;
    try {
      // Claude may return markdown code blocks, extract JSON
      const jsonMatch = messageContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      const jsonText = jsonMatch ? jsonMatch[1] : messageContent;

      rawJson = JSON.parse(jsonText) as RawClaudeResponse;
    } catch (error) {
      console.error('[ClaudeVisionService] Failed to parse JSON:', messageContent);
      throw new Error(
        `Invalid JSON response from Claude Vision API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Save debug log with cost information
    await this.saveLogToFile(imageUrls, prompt, category, response, rawJson, cost);

    // Capture actual token usage from the API response (used by upstream cost tracking)
    const tokensUsed = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    // Convert raw response to typed VisionExtractionResult
    const result = this.convertToVisionExtractionResult(
      rawJson,
      category,
      imageUrls.length,
      tokensUsed
    );

    console.log(
      `[ClaudeVisionService] Extracted ${category}: confidence=${result.visionExtraction.confidence}`
    );

    return result;
  }

  /**
   * Convert raw JSON response to VisionExtractionResult
   */
  private convertToVisionExtractionResult(
    raw: RawClaudeResponse,
    category: string,
    totalImagesAnalyzed: number,
    tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): VisionExtractionResult {
    // Convert raw items to typed arrays
    const menuItems: MenuItem[] = (raw.menuItems ?? []).map((item) =>
      this.convertToMenuItem(item)
    );

    const goodsItems: GoodsItem[] = (raw.goodsItems ?? []).map((item) =>
      this.convertToGoodsItem(item)
    );

    const noveltyItems: NoveltyItem[] = (raw.noveltyItems ?? []).map((item) =>
      this.convertToNoveltyItem(item)
    );

    // Calculate overall confidence from individual item confidences (all 3 categories per v1.2)
    const confidence = this.calculateOverallConfidence(raw, menuItems, goodsItems, noveltyItems);

    const result: VisionExtractionResult = {
      visionExtraction: {
        confidence,
        provider: 'claude',
        timestamp: new Date().toISOString(),
        menuItems,
        goodsItems,
        noveltyItems,
        metadata: {
          hasComingSoonNotice: raw.metadata?.hasComingSoonNotice ?? false,
          totalImagesAnalyzed,
          tokensUsed,
        },
      },
    };

    // Layer 2 contract validation (Schema-SDD Phase 3): throw on shape drift
    // so that LLM output regressions surface immediately rather than silently
    // propagating downstream. The caller's retry loop in `extractFromImages`
    // re-throws ZodError without retry (deterministic shape failure, not a
    // transient network issue), surfacing the bug immediately.
    return VisionExtractionResultSchema.parse(result);
  }

  /**
   * Calculate overall confidence score
   *
   * @description
   * Strategy:
   * 1. If raw response has top-level confidence, use it
   * 2. Otherwise, calculate average from individual item confidences
   * 3. Default to 0.5 if no confidence data available
   */
  private calculateOverallConfidence(
    raw: RawClaudeResponse,
    menuItems: MenuItem[],
    goodsItems: GoodsItem[],
    noveltyItems: NoveltyItem[]
  ): number {
    // Strategy 1: Use top-level confidence if available
    if (raw.confidence !== undefined && raw.confidence !== null) {
      return raw.confidence;
    }

    // Strategy 2: Calculate average from individual items across all 3 categories
    // (Templates v1.2 added confidence to GoodsItem and NoveltyItem; previously
    // only menu items contributed.)
    const allConfidences: number[] = [];

    for (const item of menuItems) {
      if (item.confidence !== undefined && item.confidence !== null) {
        allConfidences.push(item.confidence);
      }
    }

    for (const item of goodsItems) {
      if (item.confidence !== undefined && item.confidence !== null) {
        allConfidences.push(item.confidence);
      }
    }

    for (const item of noveltyItems) {
      if (item.confidence !== undefined && item.confidence !== null) {
        allConfidences.push(item.confidence);
      }
    }

    // Calculate average
    if (allConfidences.length > 0) {
      const average = allConfidences.reduce((sum, conf) => sum + conf, 0) / allConfidences.length;
      return Math.round(average * 100) / 100; // Round to 2 decimal places
    }

    // Strategy 3: Default to 0.5 if no confidence data
    return 0.5;
  }

  /**
   * Convert raw object to MenuItem
   */
  private convertToMenuItem(raw: Record<string, unknown>): MenuItem {
    return {
      name: String(raw.name || ''),
      price: typeof raw.price === 'number' ? raw.price : undefined,
      characterName: this.parseCharacterNameArray(raw.characterName, raw.name),
      hasNovelty: typeof raw.hasNovelty === 'boolean' ? raw.hasNovelty : false,
      noveltyCondition: raw.noveltyCondition ? String(raw.noveltyCondition) : undefined,
      bonus: raw.bonus ? String(raw.bonus) : undefined,
      description: raw.description ? String(raw.description) : undefined,
      notes: raw.notes ? String(raw.notes) : undefined,
      remarks: raw.remarks ? String(raw.remarks) : undefined,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
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
        `[ClaudeVisionService] Unexpected string format for characterName: "${value}". ` +
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
   * Convert raw object to GoodsItem
   */
  private convertToGoodsItem(raw: Record<string, unknown>): GoodsItem {
    return {
      name: String(raw.name || ''),
      price: typeof raw.price === 'number' ? raw.price : undefined,
      variantCount: typeof raw.variantCount === 'number' ? raw.variantCount : undefined,
      variantDetails: raw.variantDetails ? String(raw.variantDetails) : undefined,
      characterName: this.parseCharacterNameArray(raw.characterName, raw.name),
      isRandomSale: typeof raw.isRandomSale === 'boolean' ? raw.isRandomSale : false,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    };
  }

  /**
   * Convert raw object to NoveltyItem
   */
  private convertToNoveltyItem(raw: Record<string, unknown>): NoveltyItem {
    return {
      name: String(raw.name || ''),
      condition: raw.condition ? String(raw.condition) : undefined,
      variantCount: typeof raw.variantCount === 'number' ? raw.variantCount : undefined,
      characterName: this.parseCharacterNameArray(raw.characterName, raw.name),
      isRandom: typeof raw.isRandom === 'boolean' ? raw.isRandom : false,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
      notes: raw.notes ? String(raw.notes) : undefined,
      remarks: raw.remarks ? String(raw.remarks) : undefined,
    };
  }

  /**
   * Sleep for specified milliseconds
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
      return urlObj.hostname
        .replace(/^www\./, '')
        .replace(/\./g, '-');
    } catch {
      return 'unknown-domain';
    }
  }

  /**
   * Save Claude Vision API request/response to log file
   */
  private async saveLogToFile(
    imageUrls: string[],
    prompt: string,
    category: string,
    response: Anthropic.Messages.Message,
    rawJson: RawClaudeResponse,
    cost: CostResult
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
    const dateStr = jstDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const provider = 'Claude';
    const domain = this.extractDomain(imageUrls[0] || 'unknown');
    // Monotonic millisecond timestamp avoids TOCTOU + blocking readdirSync seen in
    // the previous getNextLogSequence implementation.
    const tsSuffix = now.getTime().toString();

    const fileName = `${dateStr}-VisionAPI-${provider}-${domain}-${tsSuffix}.log`;
    const filePath = path.join(this.logDir, fileName);

    const logContent = [
      '='.repeat(80),
      'Claude Vision API Debug Log',
      '='.repeat(80),
      '',
      '## Timestamp',
      jstDate.toISOString().replace('Z', '+09:00'), // JST format
      '',
      '## Request Info',
      `Category: ${category}`,
      `Model: ${this.modelName}`,
      `Image Count: ${imageUrls.length}`,
      '',
      '## Image URLs',
      ...imageUrls.map((url, idx) => `${idx + 1}. ${url}`),
      '',
      '## Prompt',
      '-'.repeat(80),
      prompt,
      '-'.repeat(80),
      '',
      '## Response Metadata',
      `Model: ${response.model}`,
      `Stop Reason: ${response.stop_reason || 'unknown'}`,
      `Input Tokens: ${response.usage.input_tokens}`,
      `Output Tokens: ${response.usage.output_tokens}`,
      `Cache Creation Tokens: ${response.usage.cache_creation_input_tokens ?? 0}`,
      `Cache Read Tokens: ${response.usage.cache_read_input_tokens ?? 0}`,
      '',
      '## Cost Analysis',
      `Total Cost: $${cost.usd.toFixed(5)} (約¥${cost.jpy.toFixed(2)})`,
      `  - Input Cost: $${cost.breakdown.inputCost.toFixed(5)}`,
      `  - Output Cost: $${cost.breakdown.outputCost.toFixed(5)}`,
      `  - Cache Creation Cost: $${cost.breakdown.cacheCreationCost.toFixed(5)} (write @ 1.25x base)`,
      `  - Cache Read Cost: $${cost.breakdown.cachedCost.toFixed(5)} (read @ 0.1x base)`,
      '',
      '## Raw JSON Response',
      '-'.repeat(80),
      JSON.stringify(rawJson, null, 2),
      '-'.repeat(80),
      '',
      '## Extracted Items Summary',
      `Menu Items: ${rawJson.menuItems?.length || 0}`,
      `Goods Items: ${rawJson.goodsItems?.length || 0}`,
      `Novelty Items: ${rawJson.noveltyItems?.length || 0}`,
      `Confidence: ${rawJson.confidence ?? 0.5}`,
      `Has Coming Soon Notice: ${rawJson.metadata?.hasComingSoonNotice ?? false}`,
      '',
      '='.repeat(80),
    ].join('\n');

    fs.writeFileSync(filePath, logContent, 'utf-8');
    console.log(`[ClaudeVisionService] Log saved: ${fileName}`);
  }
}
