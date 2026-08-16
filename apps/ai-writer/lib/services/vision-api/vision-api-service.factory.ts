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
 * // Explicitly use Anthropic Claude
 * const claudeService = VisionApiServiceFactory.create('anthropic');
 *
 * // With custom configuration
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
        // Detail resolution order: explicit config > VISION_API_DETAIL env > 'low' (cost-optimized default)
        // 'high' opt-in is intended for cases where Japanese OCR accuracy is required.
        // detail=high costs ~10x more tokens than detail=low (per OpenAI pricing).
        const envDetail = process.env.VISION_API_DETAIL as 'low' | 'high' | 'auto' | undefined;
        return new OpenAiVisionService({
          apiKey: config?.apiKey,
          model: modelName,
          detail: config?.detail ?? envDetail ?? 'low',
        });
      }

      case 'anthropic':
        return new ClaudeVisionService({
          apiKey: config?.apiKey,
          model: modelName,
        });

      case 'google':
        // ⚠️ `VISION_API_MEDIA_RESOLUTION` / `VISION_API_THINKING_LEVEL` は Gemini 専用。
        // 未指定時はどちらも `low` (画像 1 枚 252 トークン / thinking 最小限)。
        // Gemini 側の既定は media resolution が high 相当で 1,083 トークンかかるため、
        // 明示しないとコストが 4.2 倍になる (2026-08-16 実測)。
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
