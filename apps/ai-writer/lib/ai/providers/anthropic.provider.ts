/**
 * Anthropic AI Provider Implementation
 *
 * Purpose:
 *   - Wrap existing ClaudeAPIService with AiProvider interface
 *   - Enable provider switching through Strategy pattern
 *   - Maintain backward compatibility with existing code
 *
 * @module lib/ai/providers/anthropic.provider
 */

import { ClaudeAPIService } from '../../services/claude-api.service';
import type {
  AiProvider,
  ArticleGenerationRequest,
  GeneratedArticle,
  RssExtractionInput,
  RssExtractionResult,
} from './ai-provider.interface';

/**
 * Anthropic Claude Provider
 *
 * @description
 * Wraps the existing ClaudeAPIService to implement the AiProvider interface.
 * This allows seamless integration with the provider factory pattern while
 * maintaining compatibility with existing Claude-specific functionality.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider();
 * const article = await provider.generateArticle({
 *   title: "Sample Article",
 *   sourceContent: "Content here...",
 * });
 * ```
 */
export class AnthropicProvider implements AiProvider {
  private claudeService: ClaudeAPIService;

  /**
   * Initialize Anthropic Provider
   *
   * @param apiKey - Optional API key override (defaults to ANTHROPIC_API_KEY env var)
   */
  constructor(apiKey?: string) {
    this.claudeService = new ClaudeAPIService(apiKey);
  }

  /**
   * Generate an article based on source content or topic
   *
   * @param request - Article generation request
   * @returns Generated article with metadata
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    return await this.claudeService.generateArticle(request);
  }

  /**
   * Generate URL-friendly slug from text (typically Japanese)
   *
   * @param title - Text to convert to slug (e.g., "呪術廻戦")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "jujutsu-kaisen")
   */
  async generateSlug(title: string, context?: string): Promise<string> {
    // ClaudeAPIService.generateSlug doesn't use context parameter
    // Future enhancement: pass context to Claude prompt for better results
    return await this.claudeService.generateSlug(title);
  }

  /**
   * Extract work/store/event information from RSS text
   *
   * @param input - RSS text to extract from
   * @returns Extracted information with confidence score
   *
   * @throws Error - This method is not implemented in ClaudeAPIService
   * @todo Implement RSS extraction in ClaudeAPIService or use separate extractor
   */
  async extractFromRss(input: RssExtractionInput): Promise<RssExtractionResult> {
    // ClaudeAPIService doesn't have RSS extraction
    // RSS extraction is handled by lib/claude/rss-extractor.ts
    // For now, throw an error - will be implemented when refactoring rss-extractor
    throw new Error(
      'RSS extraction is not yet integrated with AnthropicProvider. ' +
        'Use lib/claude/rss-extractor.ts directly for now.'
    );
  }

  /**
   * Generate article excerpt/summary
   *
   * @param content - Article content
   * @param maxLength - Maximum length of excerpt (default: 150)
   * @returns Generated excerpt
   */
  async generateExcerpt(content: string, maxLength: number = 150): Promise<string> {
    return await this.claudeService.generateExcerpt(content, maxLength);
  }

  /**
   * Test connection to Anthropic Claude API
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    return await this.claudeService.testConnection();
  }
}
