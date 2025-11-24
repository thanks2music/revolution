/**
 * AI Provider Common Interface
 *
 * Purpose:
 *   - Abstract interface for multiple AI providers (Anthropic, Gemini, OpenAI)
 *   - Enable provider switching without changing consumer code
 *   - Support Strategy pattern implementation
 *
 * @module lib/ai/providers/ai-provider.interface
 */

/**
 * Supported AI provider types
 */
export type AiProviderType = 'anthropic' | 'gemini' | 'openai';

/**
 * Article generation request
 */
export interface ArticleGenerationRequest {
  title: string;
  sourceUrl?: string;
  sourceContent?: string;
  keywords?: string[];
  targetLength?: number;
  tone?: 'professional' | 'casual' | 'technical' | 'friendly';
  language?: 'ja' | 'en';
}

/**
 * Generated article result
 */
export interface GeneratedArticle {
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  tags: string[];
  categories: string[];
  metadata: {
    sourceUrl?: string;
    generatedAt: string;
    wordCount: number;
    model: string;
  };
}

/**
 * RSS extraction input
 */
export interface RssExtractionInput {
  /** RSS item title */
  title: string;
  /** RSS item content/description */
  content: string;
  /** RSS item link (optional) */
  link?: string;
}

/**
 * RSS extraction result
 */
export interface RssExtractionResult {
  /** Extracted work title (e.g., "呪術廻戦") */
  workTitle: string;
  /** Extracted store/brand name (e.g., "BOX cafe&space") */
  storeName: string;
  /** Extracted event type name (e.g., "コラボカフェ") */
  eventTypeName: string;
  /** Model used for extraction */
  model: string;
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Common interface for AI providers
 *
 * @description
 * All AI providers (Anthropic Claude, Google Gemini, OpenAI ChatGPT)
 * must implement this interface to ensure consistent behavior.
 *
 * @example
 * ```typescript
 * class AnthropicProvider implements AiProvider {
 *   async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
 *     // Implementation using Anthropic SDK
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface AiProvider {
  /**
   * Generate an article based on source content or topic
   *
   * @param request - Article generation request
   * @returns Generated article with metadata
   */
  generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle>;

  /**
   * Generate URL-friendly slug from text (typically Japanese)
   *
   * @param title - Text to convert to slug (e.g., "呪術廻戦")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "jujutsu-kaisen")
   */
  generateSlug(title: string, context?: string): Promise<string>;

  /**
   * Extract work/store/event information from RSS text
   *
   * @param input - RSS text to extract from
   * @returns Extracted information with confidence score
   */
  extractFromRss(input: RssExtractionInput): Promise<RssExtractionResult>;

  /**
   * Generate article excerpt/summary
   *
   * @param content - Article content
   * @param maxLength - Maximum length of excerpt (default: 150)
   * @returns Generated excerpt
   */
  generateExcerpt(content: string, maxLength?: number): Promise<string>;

  /**
   * Test connection to AI provider API
   *
   * @returns True if connection successful
   */
  testConnection(): Promise<boolean>;
}
