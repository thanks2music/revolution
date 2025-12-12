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
 * Generates a full slug with year suffix
 *
 * @description
 * Creates a complete slug in the format: `{post-id}-{year}`
 * Used in URL structure: `/collabo-cafe/{work-slug}/{slug}`
 *
 * @param {number} year - The event year (e.g., 2025)
 * @param {GeneratePostIdOptions} options - Post ID generation options
 * @returns {string} Full slug with year suffix
 *
 * @example
 * ```typescript
 * const slug = generateSlugWithYear(2025);
 * console.log(slug); // "01jcxy4567-2025"
 * ```
 *
 * @throws {Error} If year is invalid or post ID generation fails
 */
export function generateSlugWithYear(
  year: number,
  options: GeneratePostIdOptions = {}
): string {
  // Validation: Year must be a positive integer
  if (!Number.isInteger(year) || year <= 0) {
    throw new Error(`Invalid year: ${year}. Year must be a positive integer.`);
  }

  // Validation: Year should be reasonable (between 2020 and 2100)
  if (year < 2020 || year > 2100) {
    throw new Error(
      `Invalid year: ${year}. Year must be between 2020 and 2100.`
    );
  }

  const postId = generatePostId(options);
  return `${postId}-${year}`;
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

/**
 * Validates if a string is a valid slug with year
 *
 * @param {string} slug - The slug to validate
 * @returns {boolean} True if valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidSlugWithYear("01jcxy4567-2025"); // true
 * isValidSlugWithYear("01jcxy4567");      // false (missing year)
 * isValidSlugWithYear("01jcxy4567-25");   // false (year must be 4 digits)
 * ```
 */
export function isValidSlugWithYear(slug: string): boolean {
  const pattern = /^[0-9a-z]{10}-\d{4}$/;
  return pattern.test(slug);
}

/**
 * Parses a slug with year into its components
 *
 * @param {string} slug - The slug to parse (format: "postId-year")
 * @returns {{ postId: PostId; year: number } | null} Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * const result = parseSlugWithYear("01jcxy4567-2025");
 * // { postId: "01jcxy4567", year: 2025 }
 *
 * const invalid = parseSlugWithYear("invalid-slug");
 * // null
 * ```
 */
export function parseSlugWithYear(
  slug: string
): { postId: PostId; year: number } | null {
  if (!isValidSlugWithYear(slug)) {
    return null;
  }

  const [postId, yearStr] = slug.split('-');
  const year = parseInt(yearStr, 10);

  return { postId, year };
}
