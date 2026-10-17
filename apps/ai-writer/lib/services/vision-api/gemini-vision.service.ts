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
 * であり、URL を渡す例は存在しない。2026-10-12 からは 3 社とも、`prepareVisionImages` が
 * 取得・分割した画像を base64 で受け取る。
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
  VisionApiCallOptions,
  VisionImage,
  VisionProvider,
  TokenCalculationResult,
} from '@/lib/types/vision-api';
import { normalizeVisionResponse } from './normalize-vision-response';
import { calculateCost, formatCost, type CostResult } from '@/lib/ai/cost';
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
    const { images, prompt, category, maxRetries = 3, timeout = 30000 } = options;

    console.log(
      `[GeminiVisionService] Extracting ${category} from ${images.length} images ` +
        `(mediaResolution: ${this.mediaResolution})`
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(
          `[GeminiVisionService] Attempt ${attempt + 1}/${maxRetries} for category: ${category}`
        );

        const { raw: rawResponse, usage } = await this.callVisionApiWithTimeout(
          images,
          prompt,
          category,
          timeout
        );

        const result = normalizeVisionResponse(rawResponse, {
          provider: 'google',
          totalImagesAnalyzed: images.length,
          tokensUsed: usage,
        });

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
    images: VisionImage[],
    prompt: string,
    category: string,
    timeout: number
  ): Promise<{
    raw: unknown;
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
        this.callVisionApi(images, prompt, category),
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
    images: VisionImage[],
    prompt: string,
    category: string
  ): Promise<{
    raw: unknown;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const startTime = Date.now();

    // Use the caller-provided prompt as-is (per IVisionApiService contract).
    // The prompt itself lives in the Templates YAML — never hardcode it here.
    const parts: Part[] = [{ text: prompt }];
    for (const image of images) {
      parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
    }

    console.log(
      `[GeminiVisionService] Calling Gemini Vision API with ${images.length} images ` +
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

    const domain = this.extractDomain(images[0]?.source ?? '');
    await this.saveLogToFile(
      domain,
      category,
      images.map((image) => image.source),
      prompt,
      rawContent,
      response,
      elapsedTime,
      cost
    );

    console.log(
      `[GeminiVisionService] ✅ API call completed in ${elapsedTime}ms (tokens: ${usage.totalTokens})`
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error('[GeminiVisionService] Failed to parse JSON response:', rawContent);
      throw new Error(`Invalid JSON response from Gemini Vision API: ${rawContent}`);
    }

    return { raw: parsed, usage };
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
    imageSources: string[],
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

Images (${imageSources.length}):
${imageSources.map((source, i) => `${i + 1}. ${source}`).join('\n')}

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
