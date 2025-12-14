/**
 * AI API Integration Module Entry Point
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 *
 * @module lib/claude
 */

// Export types
export type {
  GenerateMetadataInput,
  ArticleMetadata,
  AiMetadataResponse,
} from './types';

export { METADATA_DEFAULTS } from './types';

// Export metadata generator
export { generateArticleMetadata } from './metadata-generator';

// Export RSS extractor
export type {
  RssExtractionInput,
  RssExtractionResult,
} from './rss-extractor';

export { extractFromRss } from './rss-extractor';
