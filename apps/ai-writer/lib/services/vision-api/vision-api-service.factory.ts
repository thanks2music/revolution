/**
 * Vision API Service Factory
 *
 * @description
 * Factory pattern for creating Vision API service instances.
 * Supports OpenAI and Claude providers.
 *
 * @package revolution
 * @module services/vision-api/factory
 */
import type {
  IVisionApiService,
  VisionProvider,
  VisionApiConfig,
} from '@/lib/types/vision-api';
import { OpenAiVisionService } from './openai-vision.service';
import { ClaudeVisionService } from './claude-vision.service';

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
 * // Explicitly use Claude
 * const claudeService = VisionApiServiceFactory.create('claude');
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
   * @param provider - Optional provider override ('openai' or 'claude')
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

    switch (selectedProvider) {
      case 'openai': {
        // Detail resolution order: explicit config > VISION_API_DETAIL env > 'low' (cost-optimized default)
        // 'high' opt-in is intended for cases where Japanese OCR accuracy is required.
        // detail=high costs ~10x more tokens than detail=low (per OpenAI pricing).
        const envDetail = process.env.VISION_API_DETAIL as 'low' | 'high' | 'auto' | undefined;
        return new OpenAiVisionService({
          apiKey: config?.apiKey,
          detail: config?.detail ?? envDetail ?? 'low',
        });
      }

      case 'claude':
        return new ClaudeVisionService({
          apiKey: config?.apiKey,
        });

      default:
        throw new Error(
          `Unknown Vision API provider: ${selectedProvider}. Supported providers: openai, claude`
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
