/**
 * Claude Vision API Service
 *
 * @description
 * Claude Vision API (Sonnet 5.5) implementation.
 *
 * Cost: `lib/ai/cost/model-pricing.ts` の単価で計算する (Sonnet 5.5 は $2.00/1M input, $10.00/1M output)。
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
import type Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import type {
  IVisionApiService,
  VisionApiCallOptions,
  VisionExtractionResult,
  VisionProvider,
  TokenCalculationResult,
} from '@/lib/types/vision-api';
import { normalizeVisionResponse } from './normalize-vision-response';
import { createAnthropicClient } from '@/lib/ai/anthropic-client';
import { ClaudeIncompleteResponseError, readClaudeText } from '@/lib/ai/claude-response';
import { calculateCost, formatCost, type CostResult } from '@/lib/ai/cost';
import { CLAUDE_THINKING_SETTINGS, DEFAULT_CLAUDE_MODEL, claudeMaxTokens } from '@/lib/config/claude-models';
import { assertHttpImageUrls } from '@/lib/utils/vision-api-utils';


export class ClaudeVisionService implements IVisionApiService {
  private client: Anthropic;
  private modelName: string;
  private logDir: string;

  /**
   * 認証は `createAnthropicClient` が決める (Cloud Run は ID フェデレーション、ローカルは
   * `ant auth login` のプロファイル)。2026-10-11 に Vision 専用のキー (`ANTHROPIC_API_KEY_VISION`)
   * を廃止し、本文の生成と同じ ID で呼ぶ。費用は step ごとのコストの記録で分けて追える。
   *
   * @param config.client - テスト用の差し替え。既定は `createAnthropicClient()`
   */
  constructor(config?: { model?: string; client?: Anthropic }) {
    this.client = config?.client ?? createAnthropicClient();
    // 既定モデル。`VISION_API_MODEL` / config で上書きできる
    this.modelName = config?.model || DEFAULT_CLAUDE_MODEL;

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
    return 'anthropic';
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
    const estimatedCost = calculateCost(this.modelName, {
      promptTokens: totalTokens,
      completionTokens: 0,
      totalTokens,
    }).usd;

    return {
      provider: 'anthropic',
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
        // 拒否と切り詰め (ClaudeIncompleteResponseError) も、同じ入力で再送しても変わらないので
        // リトライしない (Gemini の Vision と同じ扱い)
        if (error instanceof ZodError || error instanceof ClaudeIncompleteResponseError) {
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
    // 時間切れのときはリクエストも止める。止めないと裏で完了して課金され、結果は捨てられる
    const controller = new AbortController();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        controller.abort();
        reject(new Error(`Claude Vision API timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const apiPromise = this.callClaudeVisionApi(imageUrls, prompt, category, controller.signal);

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
    category: string,
    signal: AbortSignal
  ): Promise<VisionExtractionResult> {
    // Anthropic prompt cache is prefix-based: `cache_control` on a block caches
    // everything from the start of the message up to that block. The static
    // text prompt must precede the per-article images so image variation does
    // not invalidate the cache prefix. Prompts shorter than the model's minimum
    // cacheable size (512 tokens on Sonnet 5.5) are silently not cached (no error).
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
      response = await this.client.messages.create(
        {
          model: this.modelName,
          max_tokens: claudeMaxTokens(4096),
          ...CLAUDE_THINKING_SETTINGS,
          messages: [
            {
              role: 'user',
              content,
            },
          ],
        },
        { signal }
      );
      console.log('[ClaudeVisionService] API call completed successfully');
    } catch (apiError) {
      console.error('[ClaudeVisionService] API call failed:', apiError);
      throw apiError;
    }

    // Anthropic returns null on these fields when no cache breakpoint was used.
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

    const messageContent = readClaudeText(response, `ClaudeVisionService ${category}`);
    if (!messageContent) {
      throw new Error('Empty response from Claude Vision API');
    }

    // Parse JSON response
    let rawJson: unknown;
    try {
      // Claude may return markdown code blocks, extract JSON
      const jsonMatch = messageContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      const jsonText = jsonMatch ? jsonMatch[1] : messageContent;

      rawJson = JSON.parse(jsonText);
    } catch (error) {
      console.error('[ClaudeVisionService] Failed to parse JSON:', messageContent);
      throw new Error(
        `Invalid JSON response from Claude Vision API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Capture actual token usage from the API response (used by upstream cost tracking).
    // totalTokens follows Anthropic's official definition: input + output + cache_creation + cache_read
    // (https://docs.claude.com/en/docs/build-with-claude/prompt-caching).
    const tokensUsed = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens:
        response.usage.input_tokens +
        response.usage.output_tokens +
        cacheCreationTokens +
        cachedTokens,
      cachedTokens,
      cacheCreationTokens,
    };

    // Convert raw response to typed VisionExtractionResult
    const result = normalizeVisionResponse(rawJson, {
      provider: 'anthropic',
      totalImagesAnalyzed: imageUrls.length,
      tokensUsed,
    });

    // Save debug log with cost information
    await this.saveLogToFile(imageUrls, prompt, category, response, rawJson, result, cost);

    console.log(
      `[ClaudeVisionService] Extracted ${category}: confidence=${result.visionExtraction.confidence}`
    );

    return result;
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
    rawJson: unknown,
    result: VisionExtractionResult,
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
    // ログファイル名はベンダー名で揃える (`debug-vision-api.ts` が
    // VISION_API_PROVIDER の値から同じ綴りを組み立てて案内するため、
    // ここを 'Claude' に戻すと案内と実ファイル名がずれる)。
    const provider = 'Anthropic';
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
      `  - Cache Creation Cost: $${cost.breakdown.cacheCreationCost.toFixed(5)}`,
      `  - Cache Read Cost: $${cost.breakdown.cachedCost.toFixed(5)}`,
      '',
      '## Raw JSON Response',
      '-'.repeat(80),
      JSON.stringify(rawJson, null, 2),
      '-'.repeat(80),
      '',
      '## Extracted Items Summary',
      `Menu Items: ${result.visionExtraction.menuItems.length}`,
      `Goods Items: ${result.visionExtraction.goodsItems.length}`,
      `Novelty Items: ${result.visionExtraction.noveltyItems.length}`,
      `Confidence: ${result.visionExtraction.confidence}`,
      `Has Coming Soon Notice: ${result.visionExtraction.metadata?.hasComingSoonNotice ?? false}`,
      '',
      '='.repeat(80),
    ].join('\n');

    fs.writeFileSync(filePath, logContent, 'utf-8');
    console.log(`[ClaudeVisionService] Log saved: ${fileName}`);
  }
}
