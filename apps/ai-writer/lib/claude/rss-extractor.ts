/**
 * RSS Extractor Module
 *
 * Purpose:
 *   - Extract workTitle, storeName, eventTypeName from RSS text using AI Provider
 *   - Support MDX pipeline production flow (Phase 0.2)
 *   - Multi-provider support via AI Factory (Anthropic, Gemini, OpenAI)
 *
 * @module lib/claude/rss-extractor
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Section: MDXパイプライン本番運用のための実装漏れについて
 */

import { createAiProvider } from '../ai/factory/ai-factory';
import type {
  RssExtractionInput,
  RssExtractionResult,
} from '../ai/providers/ai-provider.interface';

// Re-export types for backward compatibility
export type { RssExtractionInput, RssExtractionResult };

/**
 * Extract work/store/event information from RSS text using AI Provider
 *
 * @param input - RSS text to extract from
 * @param _apiKey - Deprecated: API key is now managed by the provider
 * @returns Extracted information
 *
 * @description
 * This function now uses the unified AI Provider abstraction layer.
 * The provider is selected based on the AI_PROVIDER environment variable:
 * - AI_PROVIDER=anthropic (default): Use Claude
 * - AI_PROVIDER=gemini: Use Google Gemini
 * - AI_PROVIDER=openai: Use OpenAI GPT
 *
 * @example
 * ```typescript
 * // Using default provider (based on AI_PROVIDER env var)
 * const result = await extractFromRss({
 *   title: "作品名×店舗名2025が開催",
 *   content: "今年も「渋谷事変」のコラボレーションカフェが開催決定..."
 * });
 *
 * console.log(result.workTitle); // "作品名"
 * console.log(result.storeName); // "店舗名"
 * console.log(result.eventTypeName); // "コラボカフェ"
 * ```
 */
export async function extractFromRss(
  input: RssExtractionInput,
  _apiKey?: string // Kept for backward compatibility, but ignored
): Promise<RssExtractionResult> {
  const provider = createAiProvider();
  return await provider.extractFromRss(input);
}
