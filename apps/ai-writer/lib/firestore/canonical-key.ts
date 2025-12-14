/**
 * Canonical Key Generator Module
 *
 * Purpose:
 *   - Generate canonical keys for event deduplication
 *   - Ensure consistent key format across the system
 *   - Support MVP Phase 0.1 duplication prevention
 *
 * @module lib/firestore/canonical-key
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import { resolveWorkSlug, resolveStoreSlug, resolveEventTypeSlug } from '../config';
import type { CanonicalKeyComponents } from './types';

/**
 * Generates a canonical key from components
 *
 * @description
 * Format: {workSlug}:{storeSlug}:{eventType}:{year}
 * Used as Firestore document ID for deduplication
 *
 * @param {CanonicalKeyComponents} components - Key components
 * @returns {string} Canonical key
 *
 * @example
 * ```typescript
 * const key = generateCanonicalKey({
 *   workSlug: "jujutsu-kaisen",
 *   storeSlug: "box-cafe-and-space",
 *   eventType: "collabo-cafe",
 *   year: 2025
 * });
 * console.log(key); // "jujutsu-kaisen:box-cafe-and-space:collabo-cafe:2025"
 * ```
 */
export function generateCanonicalKey(components: CanonicalKeyComponents): string {
  const { workSlug, storeSlug, eventType, year } = components;

  // Validation: All components must be non-empty strings
  if (!workSlug || !storeSlug || !eventType) {
    throw new Error(
      'All slug components (workSlug, storeSlug, eventType) must be non-empty strings'
    );
  }

  // Validation: Year must be a positive integer
  if (!Number.isInteger(year) || year <= 0) {
    throw new Error(`Invalid year: ${year}. Year must be a positive integer.`);
  }

  // Validation: Slugs should be lowercase and contain only alphanumeric and hyphens
  const slugPattern = /^[a-z0-9-]+$/;
  if (!slugPattern.test(workSlug)) {
    throw new Error(
      `Invalid workSlug format: ${workSlug}. Must be lowercase alphanumeric with hyphens.`
    );
  }
  if (!slugPattern.test(storeSlug)) {
    throw new Error(
      `Invalid storeSlug format: ${storeSlug}. Must be lowercase alphanumeric with hyphens.`
    );
  }
  if (!slugPattern.test(eventType)) {
    throw new Error(
      `Invalid eventType format: ${eventType}. Must be lowercase alphanumeric with hyphens.`
    );
  }

  return `${workSlug}:${storeSlug}:${eventType}:${year}`;
}

/**
 * Generates a canonical key from Japanese names
 *
 * @description
 * Resolves Japanese names to slugs using YAML configs,
 * then generates the canonical key
 *
 * @param {string} workTitle - Japanese work title (e.g., "呪術廻戦")
 * @param {string} storeName - Japanese store name (e.g., "BOX cafe&space")
 * @param {string} eventTypeName - Japanese event type (e.g., "コラボカフェ")
 * @param {number} year - Event year
 * @returns {Promise<{ canonicalKey: string; components: CanonicalKeyComponents }>}
 *
 * @example
 * ```typescript
 * const result = await generateCanonicalKeyFromNames(
 *   "呪術廻戦",
 *   "BOX cafe&space",
 *   "コラボカフェ",
 *   2025
 * );
 * console.log(result.canonicalKey); // "jujutsu-kaisen:box-cafe-and-space:collabo-cafe:2025"
 * console.log(result.components); // { workSlug: "jujutsu-kaisen", ... }
 * ```
 *
 * @throws {Error} If any name cannot be resolved to a slug
 */
export async function generateCanonicalKeyFromNames(
  workTitle: string,
  storeName: string,
  eventTypeName: string,
  year: number
): Promise<{ canonicalKey: string; components: CanonicalKeyComponents }> {
  // Resolve work slug (with fallback: YAML → Claude → ASCII)
  const workSlug = await resolveWorkSlug(workTitle);
  if (!workSlug) {
    throw new Error(
      `Failed to resolve work slug for title: "${workTitle}". ` +
        `All resolution methods (YAML, Claude API, ASCII) failed.`
    );
  }

  // Resolve store slug (with fallback: YAML → Claude → ASCII)
  const storeSlug = await resolveStoreSlug(storeName);
  if (!storeSlug) {
    throw new Error(
      `Failed to resolve store slug for brand: "${storeName}". ` +
        `All resolution methods (YAML, Claude API, ASCII) failed.`
    );
  }

  // Resolve event type slug (with fallback: YAML → Claude → ASCII)
  const eventType = await resolveEventTypeSlug(eventTypeName);
  if (!eventType) {
    throw new Error(
      `Failed to resolve event type slug for: "${eventTypeName}". ` +
        `All resolution methods (YAML, Claude API, ASCII) failed.`
    );
  }

  const components: CanonicalKeyComponents = {
    workSlug,
    storeSlug,
    eventType,
    year,
  };

  const canonicalKey = generateCanonicalKey(components);

  return { canonicalKey, components };
}

/**
 * Parses a canonical key into its components
 *
 * @param {string} canonicalKey - Canonical key to parse
 * @returns {CanonicalKeyComponents | null} Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * const components = parseCanonicalKey("jujutsu-kaisen:box-cafe-and-space:collabo-cafe:2025");
 * console.log(components);
 * // {
 * //   workSlug: "jujutsu-kaisen",
 * //   storeSlug: "box-cafe-and-space",
 * //   eventType: "collabo-cafe",
 * //   year: 2025
 * // }
 * ```
 */
export function parseCanonicalKey(canonicalKey: string): CanonicalKeyComponents | null {
  const parts = canonicalKey.split(':');

  if (parts.length !== 4) {
    return null;
  }

  const [workSlug, storeSlug, eventType, yearStr] = parts;
  const year = parseInt(yearStr, 10);

  // Validation
  if (!workSlug || !storeSlug || !eventType || isNaN(year)) {
    return null;
  }

  return { workSlug, storeSlug, eventType, year };
}

/**
 * Validates if a string is a valid canonical key format
 *
 * @param {string} canonicalKey - Key to validate
 * @returns {boolean} True if valid format
 *
 * @example
 * ```typescript
 * isValidCanonicalKey("jujutsu-kaisen:box-cafe-and-space:collabo-cafe:2025"); // true
 * isValidCanonicalKey("invalid-key"); // false
 * ```
 */
export function isValidCanonicalKey(canonicalKey: string): boolean {
  return parseCanonicalKey(canonicalKey) !== null;
}
