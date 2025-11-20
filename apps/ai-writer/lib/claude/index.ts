/**
 * Claude API Integration Module Entry Point
 *
 * @module lib/claude
 */

// Export types
export type {
  GenerateMetadataInput,
  ArticleMetadata,
  ClaudeMetadataResponse,
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
