/**
 * Post ID Generation Module
 *
 * Purpose:
 *   - Generate unique post IDs using ULID (Universally Unique Lexicographically Sortable Identifier)
 *   - Ensures chronological sortability and global uniqueness
 *   - Used for article slug generation in MVP Phase 0.1
 *
 * Implementation:
 *   - Uses ULID library for base generation
 *   - Converts to lowercase for URL-friendly format
 *   - Truncates to 10 characters for brevity
 *
 * @module lib/ulid/generate-post-id
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification details
 */

import { ulid } from 'ulid';

/**
 * Post ID type definition
 * @description A 10-character lowercase ULID used as unique identifier for articles
 * @example "01jcxy4567"
 */
export type PostId = string;

/**
 * Post ID configuration options
 */
export interface GeneratePostIdOptions {
  /**
   * Optional seed time for ULID generation (for testing purposes)
   * @default Date.now()
   */
  seedTime?: number;

  /**
   * Length of the generated post ID
   * @default 10
   */
  length?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  length: 10,
} as const;

/**
 * Generates a unique post ID using ULID
 *
 * @description
 * Creates a 10-character lowercase ULID for use in article slugs.
 * ULIDs are:
 * - Lexicographically sortable (timestamp-based)
 * - Globally unique (128-bit entropy)
 * - URL-safe (lowercase alphanumeric)
 *
 * @param {GeneratePostIdOptions} options - Configuration options
 * @returns {PostId} A 10-character lowercase ULID
 *
 * @example
 * ```typescript
 * const postId = generatePostId();
 * console.log(postId); // "01jcxy4567"
 *
 * // With custom seed time (for testing)
 * const testPostId = generatePostId({ seedTime: 1234567890000 });
 * ```
 *
 * @throws {Error} If ULID generation fails
 */
export function generatePostId(options: GeneratePostIdOptions = {}): PostId {
  const { seedTime, length = DEFAULT_CONFIG.length } = options;

  try {
    // Generate ULID with optional seed time
    const rawUlid = seedTime !== undefined ? ulid(seedTime) : ulid();

    // Convert to lowercase and truncate to specified length
    const postId = rawUlid.toLowerCase().slice(0, length);

    // Validation: Ensure post ID meets requirements
    if (postId.length !== length) {
      throw new Error(
        `Generated post ID has invalid length: expected ${length}, got ${postId.length}`
      );
    }

    // Validation: Ensure alphanumeric only
    if (!/^[0-9a-z]+$/.test(postId)) {
      throw new Error(
        `Generated post ID contains invalid characters: ${postId}`
      );
    }

    return postId;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate post ID: ${error.message}`);
    }
    throw new Error('Failed to generate post ID: Unknown error');
  }
}

/**
 * Validates if a string is a valid post ID
 *
 * @param {string} postId - The post ID to validate
 * @returns {boolean} True if valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidPostId("01jcxy4567"); // true
 * isValidPostId("INVALID123"); // false (uppercase not allowed)
 * isValidPostId("short");      // false (too short)
 * ```
 */
export function isValidPostId(postId: string): boolean {
  return (
    typeof postId === 'string' &&
    postId.length === DEFAULT_CONFIG.length &&
    /^[0-9a-z]+$/.test(postId)
  );
}
