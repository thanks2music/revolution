/**
 * Google Gemini Vision API Service
 *
 * @description
 * Service for extracting menu/goods/novelty information from images using the
 * Google GenAI SDK. Implements IVisionApiService for the multi-provider architecture.
 *
 * Features:
 * - Exponential backoff retry logic (1s, 2s, 4s)
 * - Configurable media resolution (low/medium/high) — this is the cost lever
 * - Schema validation for structured output (Zod at the boundary)
 * - Detailed logging with monotonic file naming
 * - Token calculation and cost estimation
 *
 * 🔴 **Gemini は画像 URL の直渡しができない。**
 * `fileData.fileUri` に公開 HTTPS URL を渡すと **429 RESOURCE_EXHAUSTED が恒常的に
 * 返る** (2026-08-16 に 2 回実測、直後の inlineData 呼び出しは成功するのでアカウントの
 * quota ではない)。公式のリモート画像の例も「fetch して base64 にしてから `inlineData`」
 * であり、URL を渡す例は存在しない。よって本サービスは**画像を自前でダウンロードして
 * base64 で送る**。OpenAI (`image_url`) / Claude (`source.type: 'url'`) と異なる唯一の点。
 *
 * @package revolution
 * @module services/vision-api/gemini-vision
 * @see https://ai.google.dev/gemini-api/docs/generate-content/image-understanding
 */

import { GoogleGenAI, MediaResolution, ThinkingLevel } from '@google/genai';
import type { GenerateContentResponse, Part } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
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
import { VisionExtractionResultSchema } from '@revolution/schemas/vision-api-extraction';
import { calculateCost, formatCost, type CostResult } from '@/lib/ai/cost';
import { assertHttpImageUrls } from '@/lib/utils/vision-api-utils';
import {
  DEFAULT_GEMINI_MEDIA_RESOLUTION,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_THINKING_LEVEL,
  resolveMaxOutputTokens,
} from '@/lib/config/gemini-models';
import {
  GeminiBlockedResponseError,
  GeminiTruncatedResponseError,
  readGeminiText,
} from '@/lib/ai/gemini-response';
import { fetchImageSafely } from '@/lib/utils/safe-image-fetch';

/**
 * Raw Vision API Response (Internal Type)
 *
 * @description
 * Mirrors Templates v1.2 `output_schema.visionExtraction.{menu,goods,novelty}Items[]`.
 *
 * ⚠️ 本型は `openai-vision.service.ts` / `claude-vision.service.ts` にも同型の定義があり、
 * 本ファイルで 3 つ目になる (開発原則の「3 つで抽象化」の閾値に到達)。**本 PR では
 * 統合しない** — 既存 2 つは許容する optional フィールドが微妙に異なる可能性があり、
 * 突き合わせて 1 本化するのは回帰リスクを伴う独立したリファクタになるため。
 * 統合は別タスクで扱う。
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
 * 画像 1 枚あたりの入力トークン (mediaResolution 別、2026-08-16 実測)
 *
 * `gemini-3.6-flash` に同一画像を渡して計測した値。**画像のバイト数を変えても
 * 変動せず、`mediaResolution` だけで決まる** (5,969 bytes と 13,504 bytes で同値)。
 * 未指定時は HIGH と同じ 1,083 になるため、既定を LOW に倒している。
 */
const IMAGE_TOKENS_BY_RESOLUTION: Record<string, number> = {
  [MediaResolution.MEDIA_RESOLUTION_LOW]: 252,
  [MediaResolution.MEDIA_RESOLUTION_MEDIUM]: 520,
  [MediaResolution.MEDIA_RESOLUTION_HIGH]: 1083,
  [MediaResolution.MEDIA_RESOLUTION_UNSPECIFIED]: 1083,
};

/**
 * Vision プロンプトの概算トークン数
 *
 * Templates の `1.5-vision-extraction.yaml` から渡るカテゴリ別プロンプトの実測概算
 * (`notes/vision-api-cost-estimation.md` の「共通 prompt 約 2,000 tokens」と、
 * Vision ログ 27 本からの逆算 2,021 tokens が独立に一致している)。
 */
const ESTIMATED_PROMPT_TOKENS = 2000;

/** Vision の出力上限 (他 2 provider と揃える) */
const MAX_OUTPUT_TOKENS = 4096;

/** 画像ダウンロードのタイムアウト (ms、1 枚あたり) */
const IMAGE_FETCH_TIMEOUT_MS = 15000;

/**
 * Gemini Vision API Configuration
 */
interface GeminiVisionConfig {
  /** API key (optional, defaults to GEMINI_API_KEY) */
  apiKey?: string;

  /** Model name override (default: {@link DEFAULT_GEMINI_MODEL}) */
  model?: string;

  /** Media resolution (default: {@link DEFAULT_GEMINI_MEDIA_RESOLUTION}) */
  mediaResolution?: MediaResolution;

  /** Thinking level (default: {@link DEFAULT_GEMINI_THINKING_LEVEL}) */
  thinkingLevel?: ThinkingLevel;
}

/** ダウンロード済み画像 */
interface FetchedImage {
  url: string;
  data: string;
  mimeType: string;
}

/**
 * Google Gemini Vision API Service
 *
 * @example
 * ```typescript
 * const service = new GeminiVisionService({ mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM });
 * const result = await service.extractFromImages({
 *   imageUrls: ['https://example.com/menu.jpg'],
 *   prompt: 'Extract menu items',
 *   category: 'menu'
 * });
 * ```
 */
export class GeminiVisionService implements IVisionApiService {
  private client: GoogleGenAI;
  private modelName: string;
  private mediaResolution: MediaResolution;
  private thinkingLevel: ThinkingLevel;
  private logDir: string;

  constructor(config?: GeminiVisionConfig) {
    const apiKey = config?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Gemini API key is required. Set GEMINI_API_KEY environment variable or pass apiKey in config.'
      );
    }

    this.client = new GoogleGenAI({ apiKey });
    this.modelName = config?.model || DEFAULT_GEMINI_MODEL;
    this.mediaResolution = config?.mediaResolution ?? DEFAULT_GEMINI_MEDIA_RESOLUTION;
    this.thinkingLevel = config?.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL;

    // Log directory for non-production debug logs only
    // (Cloud Run has ephemeral FS; production relies on console.log → Cloud Logging)
    this.logDir = path.join(process.cwd(), 'logs');
    if (process.env.NODE_ENV !== 'production' && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    console.log(
      `[GeminiVisionService] Initialized with model: ${this.modelName}, ` +
        `mediaResolution: ${this.mediaResolution}, thinking: ${this.thinkingLevel}`
    );
  }

  /**
   * Get provider name
   *
   * @returns Provider name ('google')
   */
  getProviderName(): VisionProvider {
    return 'google';
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
   * `mediaResolution` 別の実測値 ({@link IMAGE_TOKENS_BY_RESOLUTION}) で見積もる。
   * コストは `MODEL_PRICING` 経由で算出するため、価格表を更新すれば自動追随する。
   *
   * @param imageUrls - Array of image URLs to analyze
   * @returns Token calculation result with cost estimation
   */
  async calculateTokens(imageUrls: string[]): Promise<TokenCalculationResult> {
    const perImage =
      IMAGE_TOKENS_BY_RESOLUTION[this.mediaResolution] ??
      IMAGE_TOKENS_BY_RESOLUTION[MediaResolution.MEDIA_RESOLUTION_HIGH];
    const imageTokens = imageUrls.length * perImage;
    const promptTokens = ESTIMATED_PROMPT_TOKENS;
    const totalTokens = imageTokens + promptTokens;

    // 入力側のみの見積り (出力は呼んでみないと分からないため 0 とする)
    const { usd } = calculateCost(this.modelName, {
      promptTokens: totalTokens,
      completionTokens: 0,
      totalTokens,
    });

    return {
      provider: 'google',
      totalTokens,
      breakdown: {
        imageTokens,
        promptTokens,
      },
      estimatedCost: usd,
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

    // Defense-in-depth: reject non-http(s) URLs (file://, data:, etc.) before we fetch them.
    assertHttpImageUrls(imageUrls);

    console.log(
      `[GeminiVisionService] Extracting ${category} from ${imageUrls.length} images ` +
        `(mediaResolution: ${this.mediaResolution})`
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(
          `[GeminiVisionService] Attempt ${attempt + 1}/${maxRetries} for category: ${category}`
        );

        const { raw: rawResponse, usage } = await this.callVisionApiWithTimeout(
          imageUrls,
          prompt,
          category,
          timeout
        );

        const result = this.convertToVisionExtractionResult(rawResponse, imageUrls.length, usage);

        console.log(
          `[GeminiVisionService] ✅ Extraction successful: ${result.visionExtraction.menuItems.length} menu items, ${result.visionExtraction.noveltyItems.length} novelty items, ${result.visionExtraction.goodsItems.length} goods items`
        );

        return result;
      } catch (error) {
        // ZodError from `VisionExtractionResultSchema.parse` (boundary validation)
        // means the LLM output shape is wrong — a deterministic contract failure,
        // not a transient network issue. Retrying would waste tokens and delay
        // surfacing the real bug, so re-throw immediately (mirrors the other providers).
        //
        // 🔴 Gemini の異常応答も同じ扱いにする。リトライすると 1s/2s/4s のバックオフを
        //    挟んで 3 倍のトークンを捨てるだけになる (生成側 `gemini.provider.ts` には
        //    リトライ機構が無く、ここだけ非対称だった)。
        //
        //    - 切り詰め (`MAX_TOKENS`): 原因は `maxOutputTokens` と `thinkingLevel` と
        //      いう**固定設定**。同じ config で投げ直しても再現する
        //    - ブロック (`SAFETY` / `RECITATION` 等): 原因は**入力そのもの**。
        //      同じ画像・同じプロンプトなら大抵同じ判定になる
        if (
          error instanceof ZodError ||
          error instanceof GeminiTruncatedResponseError ||
          error instanceof GeminiBlockedResponseError
        ) {
          throw error;
        }
        lastError = error as Error;
        console.error(
          `[GeminiVisionService] ❌ Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`
        );

        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`[GeminiVisionService] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error(
      `[GeminiVisionService] Failed after ${maxRetries} attempts with no error captured`
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
   * Call Gemini Vision API
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

    const images = await this.fetchImages(imageUrls);

    // Use the caller-provided prompt as-is (per IVisionApiService contract).
    // The prompt itself lives in the Templates YAML — never hardcode it here.
    const parts: Part[] = [{ text: prompt }];
    for (const image of images) {
      parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
    }

    console.log(
      `[GeminiVisionService] Calling Gemini Vision API with ${images.length}/${imageUrls.length} images ` +
        `(mediaResolution: ${this.mediaResolution})`
    );

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [{ role: 'user', parts }],
      config: {
        maxOutputTokens: resolveMaxOutputTokens(MAX_OUTPUT_TOKENS, this.thinkingLevel),
        temperature: 0.1,
        responseMimeType: 'application/json',
        mediaResolution: this.mediaResolution,
        thinkingConfig: { thinkingLevel: this.thinkingLevel },
      },
    });

    const elapsedTime = Date.now() - startTime;
    const rawContent = this.readText(response) || '{}';
    const usage = this.toUsage(response);

    // Calculate and display cost
    const cost = calculateCost(this.modelName, usage);
    console.log(`[GeminiVisionService] 💰 Cost: ${formatCost(cost)}`);

    const domain = this.extractDomain(imageUrls[0]);
    await this.saveLogToFile(
      domain,
      category,
      imageUrls,
      images.length,
      prompt,
      rawContent,
      response,
      elapsedTime,
      cost
    );

    console.log(
      `[GeminiVisionService] ✅ API call completed in ${elapsedTime}ms (tokens: ${usage.totalTokens})`
    );

    let parsed: RawVisionResponse;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error('[GeminiVisionService] Failed to parse JSON response:', rawContent);
      throw new Error(`Invalid JSON response from Gemini Vision API: ${rawContent}`);
    }

    return { raw: parsed, usage };
  }

  /**
   * 画像をダウンロードして base64 へ変換する
   *
   * 🔴 Gemini は URL 直渡しができないためここで自前取得する (ファイル冒頭の注記参照)。
   *
   * 取得に失敗した画像は**警告して除外する**。全滅した場合も例外にはせず 0 枚で続行する
   * — 「到達不能・無効な画像でも 200 + 空配列を返す」のが Vision の既存契約で
   * (`shared/schemas/vision-api-extraction.ts`)、ここだけ throw に変えると
   * 呼び出し側のハルシネーション判定の前提が provider によって変わってしまうため。
   * ただし**件数は必ず loud に出す**ので、全滅は握り潰されずログに残る。
   */
  private async fetchImages(imageUrls: string[]): Promise<FetchedImage[]> {
    const results = await Promise.all(
      imageUrls.map(async (url): Promise<FetchedImage | null> => {
        try {
          const { buffer, contentType } = await fetchImageSafely(url, {
            timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
          });
          const mimeType = this.resolveMimeType(contentType, url);

          return { url, data: buffer.toString('base64'), mimeType };
        } catch (error) {
          console.warn(
            `[GeminiVisionService] ⚠️ Image fetch failed (${error instanceof Error ? error.message : String(error)}): ${url}`
          );
          return null;
        }
      })
    );

    const images = results.filter((image): image is FetchedImage => image !== null);

    if (images.length < imageUrls.length) {
      console.warn(
        `[GeminiVisionService] ⚠️ Fetched ${images.length}/${imageUrls.length} images. ` +
          `Missing images are excluded from the request.`
      );
    }

    return images;
  }

  /**
   * `Content-Type` ヘッダ (無ければ拡張子) から MIME タイプを決める
   *
   * Gemini は `inlineData.mimeType` を必須で要求するため、推測できない場合は
   * `image/jpeg` へ倒す (Vision で扱う画像の大半が JPEG のため)。
   */
  private resolveMimeType(contentType: string | null, url: string): string {
    const fromHeader = contentType?.split(';')[0]?.trim().toLowerCase();
    if (fromHeader?.startsWith('image/')) {
      return fromHeader;
    }

    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }

  /**
   * 応答本文を取り出す。**異常終了した応答を正常な結果として返さない**
   *
   * 判定は {@link readGeminiText} に集約している (生成側と同じ実装を使うため)。
   */
  private readText(response: GenerateContentResponse): string {
    return readGeminiText(response, {
      label: 'GeminiVisionService',
      modelName: this.modelName,
      thinkingLevel: this.thinkingLevel,
      thinkingEnvName: 'VISION_API_THINKING_LEVEL',
    });
  }

  /**
   * `usageMetadata` を共通形式へ変換する
   *
   * 🔴 **thinking トークンは出力として課金される**ため `completionTokens` に合算する
   * (`gemini.provider.ts` の `toTokenUsage` と同じ理由)。
   */
  private toUsage(response: GenerateContentResponse): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    const usageMetadata = response.usageMetadata;

    return {
      promptTokens: usageMetadata?.promptTokenCount ?? 0,
      completionTokens:
        (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0),
      totalTokens: usageMetadata?.totalTokenCount ?? 0,
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

    // Aggregate per-item confidence across all 3 categories (mirrors the other
    // providers). Items without an LLM-supplied confidence are skipped so they
    // don't pull the average toward a fabricated default.
    const allConfidences: number[] = [];
    for (const item of [...menuItems, ...goodsItems, ...noveltyItems]) {
      if (item.confidence != null) {
        allConfidences.push(item.confidence);
      }
    }
    const averageConfidence =
      allConfidences.length > 0
        ? allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length
        : 0.5;

    const result: VisionExtractionResult = {
      visionExtraction: {
        confidence: averageConfidence,
        provider: 'google',
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

    // Layer 2 contract validation (Schema-SDD): throw on shape drift so that LLM
    // output regressions surface immediately rather than silently propagating.
    return VisionExtractionResultSchema.parse(result);
  }

  /**
   * Convert raw item to MenuItem.
   *
   * Numeric fields (`price`, `confidence`) use `typeof === 'number'` checks
   * rather than `??` so that LLM-emitted `null` or stringified numbers are
   * coerced to `undefined` (or the `0.5` confidence default) instead of
   * propagating to `VisionExtractionResultSchema.parse` and triggering a
   * deterministic ZodError. Mirrors the other Vision services.
   */
  private convertToMenuItem(item: NonNullable<RawVisionResponse['menuItems']>[number]): MenuItem {
    return {
      name: item.name,
      price: typeof item.price === 'number' ? item.price : undefined,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      hasNovelty: item.hasNovelty ?? false,
      noveltyCondition: item.noveltyCondition,
      bonus: item.bonus,
      description: item.description,
      notes: item.notes,
      remarks: item.remarks,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
    };
  }

  /**
   * Convert raw item to GoodsItem (see `convertToMenuItem` for numeric
   * coercion rationale).
   */
  private convertToGoodsItem(
    item: NonNullable<RawVisionResponse['goodsItems']>[number]
  ): GoodsItem {
    return {
      name: item.name,
      price: typeof item.price === 'number' ? item.price : undefined,
      variantCount: typeof item.variantCount === 'number' ? item.variantCount : undefined,
      variantDetails: item.variantDetails,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      isRandomSale: item.isRandomSale ?? false,
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
    };
  }

  /**
   * Convert raw item to NoveltyItem (see `convertToMenuItem` for numeric
   * coercion rationale).
   */
  private convertToNoveltyItem(
    item: NonNullable<RawVisionResponse['noveltyItems']>[number]
  ): NoveltyItem {
    return {
      name: item.name,
      condition: item.condition,
      variantCount: typeof item.variantCount === 'number' ? item.variantCount : undefined,
      characterName: this.parseCharacterNameArray(item.characterName, item.name),
      isRandom: item.isRandom ?? false,
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
      notes: item.notes,
      remarks: item.remarks,
    };
  }

  /**
   * Parse characterName field to string array
   *
   * @description
   * Expects array format from LLM. Applies minimal cleaning for robustness.
   * Legacy string format is NOT supported (development phase only).
   */
  private parseCharacterNameArray(value: unknown, itemName: unknown): string[] {
    // Case 1: Array (expected)
    if (Array.isArray(value)) {
      return value.map((v) => this.cleanCharacterName(String(v))).filter((v) => v.length > 0);
    }

    // Case 2: Unexpected string format (should not happen in new implementation)
    if (typeof value === 'string' && value.length > 0) {
      console.warn(
        `[GeminiVisionService] Unexpected string format for characterName: "${value}". ` +
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
   * Examples:
   * - "場地（制服ver）" → "場地"
   * - "千冬★" → "千冬"
   */
  private cleanCharacterName(name: string): string {
    return (
      name
        // Remove decorative symbols
        .replace(/[★☆♪♡【】]/g, '')
        // Remove parentheses and their contents
        .replace(/[（(][^）)]*[）)]/g, '')
        .trim()
    );
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
    fetchedImageCount: number,
    prompt: string,
    responseText: string,
    response: GenerateContentResponse,
    elapsedTime: number,
    cost: CostResult
  ): Promise<void> {
    // Skip file logging in production (Cloud Run has ephemeral filesystem).
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const now = new Date();
    // JST (UTC+9) タイムスタンプ
    const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = jstDate.toISOString().split('T')[0];
    const tsSuffix = now.getTime().toString();

    const filename = `${today}-VisionAPI-Gemini-${domain.replace(/\./g, '-')}-${category}-${tsSuffix}.log`;
    const logPath = path.join(this.logDir, filename);
    const usageMetadata = response.usageMetadata;

    const logContent = `
=================================================================
Gemini Vision API Log - ${jstDate.toISOString().replace('Z', '+09:00')}
=================================================================

Provider: google
Model: ${this.modelName}
Resolved Model: ${response.modelVersion ?? 'unknown'}
Media Resolution: ${this.mediaResolution}
Thinking Level: ${this.thinkingLevel}
Domain: ${domain}
Category: ${category}
Timestamp: ${tsSuffix}

=================================================================
REQUEST
=================================================================

Image URLs (${imageUrls.length}, fetched ${fetchedImageCount}):
${imageUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}

Prompt:
${prompt}

=================================================================
RESPONSE
=================================================================

${responseText}

=================================================================
METADATA
=================================================================

Elapsed Time: ${elapsedTime}ms
Finish Reason: ${response.candidates?.[0]?.finishReason ?? 'unknown'}
Total Tokens: ${usageMetadata?.totalTokenCount ?? 'unknown'}
Prompt Tokens: ${usageMetadata?.promptTokenCount ?? 'unknown'}
Output Tokens: ${usageMetadata?.candidatesTokenCount ?? 'unknown'}
Thinking Tokens: ${usageMetadata?.thoughtsTokenCount ?? 0}

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
    console.log(`[GeminiVisionService] Log saved: ${logPath}`);
  }
}
