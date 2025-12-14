/**
 * Claude AI Model Definitions
 *
 * Purpose:
 *   - Centralized model name constants
 *   - Single source of truth for Claude model versions
 *   - Easy migration when upgrading models
 *
 * @module lib/config/claude-models
 */

/**
 * Claude Sonnet 4.5 Model
 *
 * Primary model for:
 * - RSS extraction (rss-extractor.ts)
 * - Metadata generation (article-generator.ts)
 * - Slug generation (slug-generator.ts)
 * - Direct API calls (claude-api.service.ts)
 */
export const CLAUDE_MODEL_SONNET_4_5 = 'claude-sonnet-4-5-20250929' as const;

/**
 * Default model for all Claude API calls
 */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODEL_SONNET_4_5;

/**
 * Model type definition for type safety
 */
export type ClaudeModel = typeof CLAUDE_MODEL_SONNET_4_5;
