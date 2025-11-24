/**
 * AI Provider Factory
 *
 * Purpose:
 *   - Create AI provider instances based on environment configuration
 *   - Implement Strategy pattern for provider switching
 *   - Centralize provider selection logic
 *
 * @module lib/ai/factory/ai-factory
 */

import type { AiProvider, AiProviderType } from '../providers/ai-provider.interface';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { GeminiProvider } from '../providers/gemini.provider';
import { OpenAIProvider } from '../providers/openai.provider';

/**
 * Get the configured AI provider type from environment variables
 *
 * @returns The configured provider type (defaults to 'anthropic')
 */
export function getConfiguredProvider(): AiProviderType {
  const provider = process.env.AI_PROVIDER as AiProviderType;

  // Validate provider type
  const validProviders: AiProviderType[] = ['anthropic', 'gemini', 'openai'];
  if (provider && validProviders.includes(provider)) {
    return provider;
  }

  // Default to Anthropic if not configured or invalid
  console.warn(
    `AI_PROVIDER="${provider}" is not valid. Defaulting to "anthropic". ` +
      `Valid options: ${validProviders.join(', ')}`
  );
  return 'anthropic';
}

/**
 * Create an AI provider instance based on environment configuration
 *
 * @description
 * Factory function that creates the appropriate AI provider based on
 * the AI_PROVIDER environment variable. Currently supports:
 * - anthropic: Claude (Anthropic)
 * - gemini: Gemini (Google) - Coming soon
 * - openai: ChatGPT (OpenAI) - Coming soon
 *
 * @returns An instance of the configured AI provider
 * @throws Error if the provider type is not supported
 *
 * @example
 * ```typescript
 * // Set AI_PROVIDER=anthropic in .env.local
 * const aiProvider = createAiProvider();
 * const article = await aiProvider.generateArticle({
 *   title: "Sample Article",
 *   sourceContent: "Content here...",
 * });
 * ```
 */
export function createAiProvider(): AiProvider {
  const providerType = getConfiguredProvider();

  switch (providerType) {
    case 'anthropic':
      console.log('🤖 Using Anthropic Claude provider');
      return new AnthropicProvider();

    case 'gemini':
      console.log('🤖 Using Google Gemini provider');
      return new GeminiProvider();

    case 'openai':
      console.log('🤖 Using OpenAI GPT provider');
      return new OpenAIProvider();

    default:
      // TypeScript should never reach here due to type checking
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}

/**
 * Create a specific AI provider instance (for testing or advanced use)
 *
 * @param providerType - The specific provider to create
 * @param apiKey - Optional API key override
 * @returns An instance of the specified AI provider
 * @throws Error if the provider type is not supported
 *
 * @example
 * ```typescript
 * const claudeProvider = createSpecificProvider('anthropic', 'sk-ant-...');
 * ```
 */
export function createSpecificProvider(
  providerType: AiProviderType,
  apiKey?: string
): AiProvider {
  switch (providerType) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);

    case 'gemini':
      return new GeminiProvider(apiKey);

    case 'openai':
      return new OpenAIProvider(apiKey);

    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
