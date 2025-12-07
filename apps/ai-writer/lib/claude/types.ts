/**
 * AI Metadata Generator Types
 *
 * Purpose:
 *   - Define TypeScript interfaces for AI API metadata generation
 *   - Support Phase 0.1 article metadata extraction (categories + excerpt)
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 *
 * @module lib/claude/types
 */

/**
 * Input for article metadata generation
 */
export interface GenerateMetadataInput {
  /**
   * Article content (Markdown format)
   */
  content: string;

  /**
   * Article title (for context)
   */
  title: string;

  /**
   * Work title (Japanese, e.g., "呪術廻戦")
   * Used as context for category generation
   */
  workTitle: string;

  /**
   * Event type (Japanese, e.g., "コラボカフェ")
   * Used as context for category generation
   */
  eventType: string;

  /**
   * Optional: Maximum excerpt length (default: 150 characters)
   */
  maxExcerptLength?: number;

  /**
   * Optional: Maximum number of categories (default: 2-3)
   */
  maxCategories?: number;
}

/**
 * Generated article metadata
 */
export interface ArticleMetadata {
  /**
   * Categories for taxonomy
   * @example ['呪術廻戦', 'コラボカフェ']
   */
  categories: string[];

  /**
   * Article excerpt/summary for SEO
   * @example "呪術廻戦とBOX cafe&spaceのコラボイベントが2025年12月25日から開催されます。"
   */
  excerpt: string;
}

/**
 * AI API response structure for metadata generation
 * @internal
 */
export interface AiMetadataResponse {
  categories: string[];
  excerpt: string;
}

/**
 * Default configuration for metadata generation
 */
export const METADATA_DEFAULTS = {
  MAX_EXCERPT_LENGTH: 150,
  MAX_CATEGORIES: 3,
  MIN_CATEGORIES: 2,
  TEMPERATURE: 0.5,
  MAX_TOKENS: 500,
} as const;
