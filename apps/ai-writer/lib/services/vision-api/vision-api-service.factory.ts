/**
 * Vision API Service Factory
 *
 * @description
 * Factory pattern for creating Vision API service instances.
 * Providers are selected by vendor name (`openai` / `anthropic`), matching
 * `AiProviderType` in `lib/ai/providers/ai-provider.interface.ts`.
 *
 * @package revolution
 * @module services/vision-api/factory
 */
import type {
  IVisionApiService,
  VisionProvider,
  VisionApiConfig,
} from '@/lib/types/vision-api';
import {
  normalizeMediaResolution,
  normalizeThinkingLevel,
} from '@/lib/config/gemini-models';
import { OpenAiVisionService } from './openai-vision.service';
import { ClaudeVisionService } from './claude-vision.service';
import { GeminiVisionService } from './gemini-vision.service';

/**
 * Vision API Service Factory
 *
 * @description
 * Creates Vision API service instances based on provider configuration.
 * Supports runtime provider selection via environment variable or explicit parameter.
 *
 * @example
 * ```typescript
 * // Use default provider (from VISION_API_PROVIDER env var, or 'openai')
 * const service = VisionApiServiceFactory.create();
 *
 * // Explicitly use Anthropic Claude (no API key: lib/ai/anthropic-client.ts)
 * const claudeService = VisionApiServiceFactory.create('anthropic');
 *
 * // With custom configuration (apiKey applies to openai / google only)
 * const customService = VisionApiServiceFactory.create('openai', {
 *   apiKey: 'custom-key',
 *   detail: 'low',
 * });
 * ```
 */
export class VisionApiServiceFactory {
  /**
   * Create Vision API service instance
   *
   * @param provider - Optional provider override ('openai' or 'anthropic')
   * @param config - Optional configuration override
   * @returns Vision API service instance
   *
   * @throws {Error} If unknown provider is specified
   */
  static create(
    provider?: VisionProvider,
    config?: Partial<VisionApiConfig>
  ): IVisionApiService {
    // Determine provider: parameter > env var > default ('openai')
    const selectedProvider =
      provider ||
      (process.env.VISION_API_PROVIDER as VisionProvider) ||
      'openai';

    console.log(
      `[VisionApiServiceFactory] Creating service for provider: ${selectedProvider}`
    );

    // Model resolution order: explicit config > VISION_API_MODEL env > provider default.
    // `undefined` を渡すと各 service の constructor 既定値が使われる (既定を変えない)。
    const modelName = config?.model ?? process.env.VISION_API_MODEL?.trim() ?? undefined;

    switch (selectedProvider) {
      case 'openai': {
        // Detail resolution order: explicit config > VISION_API_DETAIL env > 'high'.
        // 品名の文字を読むため high を既定にする (2026-10-12。Gemini の HIGH とそろえる)。
        const envDetail = process.env.VISION_API_DETAIL as 'low' | 'high' | 'auto' | undefined;
        return new OpenAiVisionService({
          apiKey: config?.apiKey,
          model: modelName,
          detail: config?.detail ?? envDetail ?? 'high',
        });
      }

      case 'anthropic':
        // Anthropic は API キーを受け取らない (createAnthropicClient が認証を決める)
        return new ClaudeVisionService({ model: modelName });

      case 'google':
        // ⚠️ `VISION_API_MEDIA_RESOLUTION` / `VISION_API_THINKING_LEVEL` は Gemini 専用。
        // 未指定時は media resolution が HIGH (画像 1 枚 1,083 トークン、品名を読むため)、
        // thinking が low。既定値は `lib/config/gemini-models.ts`。
        return new GeminiVisionService({
          apiKey: config?.apiKey,
          model: modelName,
          mediaResolution: normalizeMediaResolution(process.env.VISION_API_MEDIA_RESOLUTION),
          thinkingLevel: normalizeThinkingLevel(process.env.VISION_API_THINKING_LEVEL),
        });

      default:
        throw new Error(
          `Unknown Vision API provider: ${selectedProvider}. Supported providers: openai, anthropic, google`
        );
    }
  }

  /**
   * Get default provider name
   *
   * @description
   * Returns the provider that will be used if no explicit provider is specified.
   * Reads from VISION_API_PROVIDER environment variable, defaults to 'openai'.
   *
   * @returns Default provider name
   */
  static getDefaultProvider(): VisionProvider {
    return (process.env.VISION_API_PROVIDER as VisionProvider) || 'openai';
  }
}
