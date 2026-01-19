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
import { calculateCost, formatCost } from '@/lib/ai/cost';

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

    // Initialize log directory
    this.logDir = path.join(__dirname, '..', '..', '..', 'logs');
    if (!fs.existsSync(this.logDir)) {
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
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Claude Vision API timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    const apiPromise = this.callClaudeVisionApi(imageUrls, prompt, category);

    return Promise.race([apiPromise, timeoutPromise]);
  }

  /**
   * Call Claude Vision API
   */
  private async callClaudeVisionApi(
    imageUrls: string[],
    prompt: string,
    category: string
  ): Promise<VisionExtractionResult> {
    // Build content array: images + text prompt
    // Claude expects images first, then text
    const content: Anthropic.Messages.MessageParam['content'] = [];

    // Add all images with source type = url
    for (const imageUrl of imageUrls) {
      content.push({
        type: 'image',
        source: {
          type: 'url',
          url: imageUrl,
        },
      });
    }

    // Add text prompt
    content.push({
      type: 'text',
      text: prompt,
    });

    console.log(
      `[ClaudeVisionService] Calling Claude Vision API with ${imageUrls.length} images`
    );

    let response;
    try {
      console.log('[ClaudeVisionService] Content structure:', JSON.stringify(content, null, 2));
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

    // Calculate and display cost
    const cost = calculateCost(this.modelName, {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      cachedTokens: 0, // Claude SDK doesn't return cached tokens separately
    });
    const costStr = formatCost(cost);
    console.log(`[ClaudeVisionService] 💰 Cost: ${costStr}`);

    // Debug: Log response structure
    console.log('[ClaudeVisionService] Raw response object:', JSON.stringify(response, null, 2));
    console.log('[ClaudeVisionService] Response type:', typeof response);
    console.log('[ClaudeVisionService] Response has content?:', response && 'content' in response);

    if (!response || !response.content) {
      throw new Error(`Invalid response from Claude API: response=${!!response}, content=${!!(response?.content)}`);
    }

    console.log('[ClaudeVisionService] Response content blocks:', response.content.length);
    console.log('[ClaudeVisionService] Response content types:', response.content.map((block) => block.type));

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

    // Convert raw response to typed VisionExtractionResult
    const result = this.convertToVisionExtractionResult(rawJson, category);

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
    category: string
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

    // Calculate overall confidence from individual item confidences
    const confidence = this.calculateOverallConfidence(raw, menuItems, goodsItems);

    return {
      visionExtraction: {
        confidence,
        provider: 'claude',
        timestamp: new Date().toISOString(),
        menuItems,
        goodsItems,
        noveltyItems,
        metadata: {
          hasComingSoonNotice: raw.metadata?.hasComingSoonNotice ?? false,
          totalImagesAnalyzed: 0, // Will be set by caller
        },
      },
    };
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
    goodsItems: GoodsItem[]
  ): number {
    // Strategy 1: Use top-level confidence if available
    if (raw.confidence !== undefined && raw.confidence !== null) {
      return raw.confidence;
    }

    // Strategy 2: Calculate average from individual items
    const allConfidences: number[] = [];

    // Collect menu item confidences
    for (const item of menuItems) {
      if (item.confidence !== undefined && item.confidence !== null) {
        allConfidences.push(item.confidence);
      }
    }

    // Collect goods item confidences (if they have confidence field in the future)
    // Currently GoodsItem doesn't have confidence, but keeping for consistency
    for (const item of goodsItems) {
      if ('confidence' in item && typeof item.confidence === 'number') {
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
      characterName: raw.characterName ? String(raw.characterName) : undefined,
      bonus: raw.bonus ? String(raw.bonus) : undefined,
      description: raw.description ? String(raw.description) : undefined,
      notes: raw.notes ? String(raw.notes) : undefined,
      remarks: raw.remarks ? String(raw.remarks) : undefined,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
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
      condition: raw.condition ? String(raw.condition) : undefined,
      variantCount: typeof raw.variantCount === 'number' ? raw.variantCount : undefined,
      characterName: raw.characterName ? String(raw.characterName) : undefined,
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
   * Get next log sequence number for today
   */
  private getNextLogSequence(
    dateStr: string,
    provider: string,
    domain: string
  ): number {
    const prefix = `${dateStr}-VisionAPI-${provider}-${domain}-`;
    const files = fs.readdirSync(this.logDir);

    const matchingFiles = files.filter((file) => file.startsWith(prefix));

    if (matchingFiles.length === 0) {
      return 1;
    }

    // Extract sequence numbers and find max
    const sequences = matchingFiles
      .map((file) => {
        const match = file.match(/-(\d{2})\.log$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((seq) => !isNaN(seq));

    const maxSeq = Math.max(...sequences, 0);
    return maxSeq + 1;
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
    cost: { usd: number; jpy: number; breakdown: { inputCost: number; outputCost: number; cachedCost: number } }
  ): Promise<void> {
    const now = new Date();
    // JST (UTC+9) タイムスタンプ
    const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = jstDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const provider = 'Claude';
    const domain = this.extractDomain(imageUrls[0] || 'unknown');
    const sequence = this.getNextLogSequence(dateStr, provider, domain);

    const fileName = `${dateStr}-VisionAPI-${provider}-${domain}-${sequence.toString().padStart(2, '0')}.log`;
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
      '',
      '## Cost Analysis',
      `Total Cost: $${cost.usd.toFixed(5)} (約¥${cost.jpy.toFixed(2)})`,
      `  - Input Cost: $${cost.breakdown.inputCost.toFixed(5)}`,
      `  - Output Cost: $${cost.breakdown.outputCost.toFixed(5)}`,
      `  - Cached Cost: $${cost.breakdown.cachedCost.toFixed(5)}`,
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
