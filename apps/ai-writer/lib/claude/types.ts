/**
 * AI Metadata Generator Types
 *
 * Purpose:
 *   - Define TypeScript interfaces for AI API metadata generation
 *   - Support article excerpt extraction
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 *
 * taxonomy.yaml v1.1 対応（2025-12-17）
 * categories は buildCategories() で決定論的に生成するため、AI 生成から除外
 * @see lib/utils/category-builder.ts
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
   * Work title (Japanese, e.g., "作品名")
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
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Generated article metadata
 *
 * @description
 * taxonomy.yaml v1.1 以降、categories は AI 生成ではなく
 * buildCategories() で決定論的に生成するため、オプショナルに変更
 * @see lib/utils/category-builder.ts
 */
export interface ArticleMetadata {
  /**
   * Categories for taxonomy
   * @deprecated taxonomy.yaml v1.1 以降、buildCategories() で決定論的に生成
   * @example ['作品名', 'カテゴリ名']
   */
  categories?: string[];

  /**
   * Article excerpt/summary for SEO
   * @example "作品名と店舗名のコラボイベントが2025年12月25日から開催されます。"
   */
  excerpt: string;

  /** Model used for generation */
  model?: string;

  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}

/**
 * AI API response structure for metadata generation
 *
 * @internal
 * @description
 * taxonomy.yaml v1.1 以降、categories は AI 生成から除外
 */
export interface AiMetadataResponse {
  /**
   * @deprecated taxonomy.yaml v1.1 以降、AI 生成から除外
   */
  categories?: string[];
  excerpt: string;
}

/**
 * Default configuration for metadata generation
 *
 * @description
 * taxonomy.yaml v1.1 以降、categories 関連の設定は後方互換性のために残すが、
 * 実際の categories 生成は buildCategories() で行う
 */
export const METADATA_DEFAULTS = {
  MAX_EXCERPT_LENGTH: 150,
  /** @deprecated taxonomy.yaml v1.1 以降、buildCategories() で 2 件固定 */
  MAX_CATEGORIES: 3,
  /** @deprecated taxonomy.yaml v1.1 以降、buildCategories() で 2 件固定 */
  MIN_CATEGORIES: 2,
  TEMPERATURE: 0.5,
  MAX_TOKENS: 300, // Reduced from 500 since we only generate excerpt now
} as const;
