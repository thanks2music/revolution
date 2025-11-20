/**
 * Claude Metadata Generator Module Entry Point
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
