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
import * as fs from 'fs';
import * as path from 'path';
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
  noveltyItems?: Array<Record<string, unknown>>;
  characterName?: string;
  metadata?: {
    imageQuality?: string;
    hasComingSoonNotice?: boolean;
    extractionDifficulty?: string;
  };
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
  private logDir: string;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it to the constructor.'
      );
    }

    this.client = new OpenAI({ apiKey: key });

    // Initialize log directory
    // Use __dirname to reliably resolve path from service file location
    // apps/ai-writer/lib/services -> apps/ai-writer -> logs
    this.logDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
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

    // Add all images with detail=high (TEMPORARY: Testing for better Japanese OCR)
    for (const imageUrl of imageUrls) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
          detail: 'high', // TEMPORARY: Testing high detail for Japanese text extraction
        },
      });
    }

    console.log(
      `[VisionApiService] Calling OpenAI Vision API with ${imageUrls.length} images (detail=high)`
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

    // Save debug log
    await this.saveLogToFile(imageUrls, prompt, category, response, rawJson);

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

    const noveltyItems: NoveltyItem[] = (raw.noveltyItems ?? []).map((item) =>
      this.convertToNoveltyItem(item)
    );

    return {
      visionExtraction: {
        confidence,
        provider: 'openai',
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
   * Convert raw object to MenuItem
   */
  private convertToMenuItem(raw: Record<string, unknown>): MenuItem {
    return {
      name: String(raw.name || ''),
      price: typeof raw.price === 'number' ? raw.price : undefined,
      characterName: this.parseCharacterNameArray(raw.characterName, raw.name),
      bonus: raw.bonus ? String(raw.bonus) : undefined,
      description: raw.description ? String(raw.description) : undefined,
      notes: raw.notes ? String(raw.notes) : undefined,
      remarks: raw.remarks ? String(raw.remarks) : undefined,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    };
  }

  /**
   * Parse characterName field to string array
   */
  private parseCharacterNameArray(value: unknown, menuName: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map(v => this.cleanCharacterName(String(v)))
        .filter(v => v.length > 0);
    }

    if (typeof value === 'string' && value.length > 0) {
      console.warn(
        `[VisionApiService] Unexpected string format for characterName: "${value}". ` +
        `Expected array format. Menu name: "${menuName || 'unknown'}". ` +
        `Returning empty array.`
      );
      return [];
    }

    return [];
  }

  /**
   * Clean character name
   */
  private cleanCharacterName(name: string): string {
    return name
      .replace(/[★☆♪♡【】]/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
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
   * Generate interim Vision API prompt
   *
   * @description
   * TEMPORARY: This is a hardcoded fallback prompt until YAML template is ready.
   * TODO: Move to Templates repository (1.5-vision-extraction.yaml)
   *
   * @param category - Category being extracted (menu, goods, novelty)
   * @returns Simplified prompt for Japanese text extraction
   */
  private buildInterimPrompt(category: string): string {
    return `あなたはコラボカフェのメニュー情報を抽出する専門家です。
指定した画像内に書かれている日本語の文字列を抽出してください。

想定される日本語の情報:
- メニュー名
- 金額 (メニューの料金)
- キャラクター名 (メニュー名に含まれる場合は分離して抽出)
- その他の文字列情報 (出現頻度が高い例: ノベルティ情報)

# 抽出ルール

- メニュー名にキャラクター名が含まれる場合、characterName フィールドに分離する
  例: 「場地と千冬のマカロンパフェ」→ name: "マカロンパフェ", characterName: "場地と千冬"
- キャラクター名が不明な場合は、characterName を空文字列にする

# 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "menuItems": [
    {
      "name": "メニュー名",
      "price": 1200,
      "characterName": "キャラクター名",
      "description": "コラボメニューのコンセプトや説明が書かれている場合",
      "notes": "注意点が記載されている場合 (例: 食品アレルギー表記など)",
      "remarks": "補足情報が記載されている場合 (例: 食材名や栄養成分など)",
      "confidence": 0.95
    }
  ],
  "noveltyItems": [
    {
      "name": "ノベルティ名称",
      "condition": "ノベルティ条件が記載されている場合",
      "notes": "注意点が記載されている場合 (例: 絵柄は選べませんなど)",
      "remarks": "補足情報が記載されている場合 (例: 無くなり次第終了など)"
    }
  ],
  "metadata": {
    "imageQuality": "high",
    "hasComingSoonNotice": false,
    "extractionDifficulty": "easy"
  }
}`;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract domain from URL
   *
   * @example
   * extractDomain('https://www.pripricafe.com/event/cafe/img/menu.webp')
   * // => 'pripricafe-com'
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove 'www.' prefix and replace dots with hyphens
      return urlObj.hostname
        .replace(/^www\./, '')
        .replace(/\./g, '-');
    } catch {
      return 'unknown-domain';
    }
  }

  /**
   * Get next log sequence number for today
   *
   * @example
   * // If 2026-01-18-VisionAPI-OpenAI-pripricafe-com-01.log exists
   * getNextLogSequence('2026-01-18', 'OpenAI', 'pripricafe-com')
   * // => 2
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
   * Save Vision API request/response to log file
   */
  private async saveLogToFile(
    imageUrls: string[],
    prompt: string,
    category: string,
    response: OpenAI.Chat.Completions.ChatCompletion,
    rawJson: RawVisionResponse
  ): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const provider = 'OpenAI';
    const domain = this.extractDomain(imageUrls[0] || 'unknown');
    const sequence = this.getNextLogSequence(dateStr, provider, domain);

    const fileName = `${dateStr}-VisionAPI-${provider}-${domain}-${sequence.toString().padStart(2, '0')}.log`;
    const filePath = path.join(this.logDir, fileName);

    const logContent = [
      '='.repeat(80),
      'Vision API Debug Log',
      '='.repeat(80),
      '',
      '## Timestamp',
      now.toISOString(),
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
      `Finish Reason: ${response.choices[0]?.finish_reason || 'unknown'}`,
      `Total Tokens: ${response.usage?.total_tokens || 'N/A'}`,
      `Prompt Tokens: ${response.usage?.prompt_tokens || 'N/A'}`,
      `Completion Tokens: ${response.usage?.completion_tokens || 'N/A'}`,
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
    console.log(`[VisionApiService] Log saved: ${fileName}`);
  }
}

/**
 * Singleton instance
 */
export const visionApiService = new VisionApiService();
