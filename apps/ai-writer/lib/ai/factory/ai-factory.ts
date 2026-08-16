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

import type { ThinkingLevel } from '@google/genai';
import { normalizeThinkingLevel } from '@/lib/config/gemini-models';
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
  const validProviders: AiProviderType[] = ['anthropic', 'google', 'openai'];
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
 * Get the configured model id from environment variables
 *
 * @description
 * `AI_MODEL` は **API キーではなく「どのモデル ID を叩くか」** を指定する。
 * `AI_PROVIDER` と対になる全プロバイダ共通の env で、未設定なら各 provider の
 * 既定定数がそのまま使われる (= 既存の挙動を変えない)。
 *
 * ⚠️ 値は provider に対応するものを入れること (`AI_PROVIDER=openai` に
 * `gemini-3.6-flash` を渡す等の取り違えは API 側でエラーになる)。
 *
 * @returns 設定されたモデル ID。未設定・空文字なら `undefined` (= provider の既定)
 */
export function getConfiguredModel(): string | undefined {
  return process.env.AI_MODEL?.trim() || undefined;
}

/**
 * Get the configured thinking level from environment variables
 *
 * @description
 * `AI_THINKING_LEVEL` は **Gemini 3.x でのみ効く** (Anthropic / OpenAI の provider には
 * 渡していない)。Gemini 3.x は推論モデルで **thinking トークンが出力として課金される**
 * ため、既定の `MEDIUM` のままだと出力コストが読めない。本 env で明示制御する。
 *
 * @returns 正規化済みの thinking レベル (未設定・不正値は `LOW`)
 */
export function getConfiguredThinkingLevel(): ThinkingLevel {
  return normalizeThinkingLevel(process.env.AI_THINKING_LEVEL);
}

/**
 * Create an AI provider instance based on environment configuration
 *
 * @description
 * Factory function that creates the appropriate AI provider based on
 * the AI_PROVIDER environment variable. Providers are selected by vendor
 * name, not by LLM product name. Currently supports:
 * - anthropic: Claude
 * - google: Gemini
 * - openai: ChatGPT
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
  // `undefined` を渡すと各 provider の constructor 既定値が適用される (既定を変えない)
  const modelName = getConfiguredModel();

  switch (providerType) {
    case 'anthropic':
      console.log('🤖 Using Anthropic Claude provider');
      return new AnthropicProvider(undefined, modelName);

    case 'google':
      console.log('🤖 Using Google Gemini provider');
      return new GeminiProvider(undefined, modelName, getConfiguredThinkingLevel());

    case 'openai':
      console.log('🤖 Using OpenAI GPT provider');
      return new OpenAIProvider(undefined, modelName);

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

    case 'google':
      return new GeminiProvider(apiKey);

    case 'openai':
      return new OpenAIProvider(apiKey);

    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
