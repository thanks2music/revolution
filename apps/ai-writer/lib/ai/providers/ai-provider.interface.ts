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
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * RSS extraction result
 */
export interface RssExtractionResult {
  /** Extracted work title (e.g., "作品名") */
  workTitle: string;
  /** Extracted store/brand name (e.g., "店舗名") */
  storeName: string;
  /** Extracted event type name (e.g., "コラボカフェ") */
  eventTypeName: string;
  /** Model used for extraction */
  model: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}

/**
 * Options for sendMessage() method
 *
 * @description
 * Provides flexible configuration for generic AI message sending.
 * Used for rapid prototyping and experimentation with new AI features.
 */
export interface SendMessageOptions {
  /** Maximum tokens to generate (default: provider-specific) */
  maxTokens?: number;
  /** Temperature for response randomness (0-1, default: 0) */
  temperature?: number;
  /** System prompt to set context (optional) */
  systemPrompt?: string;
  /** Expected response format hint */
  responseFormat?: 'text' | 'json';
}

/**
 * Result from sendMessage() method
 */
export interface SendMessageResult {
  /** The generated text response */
  content: string;
  /** Model used for generation */
  model: string;
  /** Token usage statistics (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
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
   * @param title - Text to convert to slug (e.g., "作品名")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "sample-work")
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

  /**
   * Send a generic message to the AI provider
   *
   * @description
   * Generic method for sending prompts to AI providers.
   * Designed for rapid prototyping and experimentation with new AI features.
   * Service layer handles prompt construction and response parsing.
   *
   * Use cases:
   * - Article selection evaluation (Step 0.5)
   * - Metadata generation (Step 4)
   * - Title generation (Step 4.5)
   * - Slug generation (Step 2)
   * - Future AI features (image analysis, content verification, etc.)
   *
   * @param prompt - The prompt to send to the AI
   * @param options - Optional configuration for the request
   * @returns Response with content and metadata
   *
   * @example
   * ```typescript
   * const result = await provider.sendMessage(
   *   "Extract the anime title from: ...",
   *   { temperature: 0, responseFormat: 'json' }
   * );
   * const parsed = JSON.parse(result.content);
   * ```
   */
  sendMessage(prompt: string, options?: SendMessageOptions): Promise<SendMessageResult>;
}
