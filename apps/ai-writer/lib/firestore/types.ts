/**
 * Firestore Types Module
 *
 * Purpose:
 *   - Define TypeScript interfaces for Firestore documents
 *   - Ensure type safety for event canonical key documents
 *   - Support MVP Phase 0.1 duplication prevention
 *
 * @module lib/firestore/types
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import type { Timestamp } from 'firebase-admin/firestore';

/**
 * Event Canonical Key Document Status
 *
 * @description
 * Tracks the lifecycle of an event article generation:
 * - pending: Event registered, article generation not started
 * - generated: Article successfully generated
 * - failed: Article generation failed permanently
 * - retryable: Article generation failed, but can be retried
 */
export type EventStatus = 'pending' | 'generated' | 'failed' | 'retryable';

/**
 * Event Canonical Key Document
 *
 * @description
 * Firestore document structure for event deduplication
 *
 * Collection: `event_canonical_keys`
 * Document ID: canonicalKey (e.g., "jujutsu-kaisen:avail:collabo-cafe:2025")
 *
 * Purpose:
 * - Prevent duplicate article generation for the same event
 * - Track article generation status
 * - Support retry logic for failed generations
 *
 * @example
 * ```typescript
 * const doc: EventCanonicalKey = {
 *   canonicalKey: "jujutsu-kaisen:avail:collabo-cafe:2025",
 *   workSlug: "jujutsu-kaisen",
 *   storeSlug: "avail",
 *   eventType: "collabo-cafe",
 *   year: 2025,
 *   postId: "01jcxy4567",
 *   status: "generated",
 *   createdAt: Timestamp.now(),
 *   updatedAt: Timestamp.now(),
 * };
 * ```
 */
export interface EventCanonicalKey {
  /**
   * Canonical key format: {workSlug}:{storeSlug}:{eventType}:{year}
   * @example "jujutsu-kaisen:avail:collabo-cafe:2025"
   */
  canonicalKey: string;

  /**
   * Work slug (romanized anime/manga title)
   * @example "jujutsu-kaisen"
   */
  workSlug: string;

  /**
   * Store slug (brand/cafe name)
   * @example "avail", "animate-cafe"
   */
  storeSlug: string;

  /**
   * Event type slug
   * @example "collabo-cafe", "pop-up-store"
   */
  eventType: string;

  /**
   * Event year (4-digit year)
   * @example 2025
   */
  year: number;

  /**
   * Post ID (10-character ULID)
   * @example "01jcxy4567"
   */
  postId: string;

  /**
   * Article generation status
   */
  status: EventStatus;

  /**
   * Document creation timestamp
   */
  createdAt: Timestamp;

  /**
   * Last update timestamp
   */
  updatedAt: Timestamp;

  /**
   * Optional: Error message if status is 'failed' or 'retryable'
   */
  errorMessage?: string;

  /**
   * Optional: Retry count for failed generations
   */
  retryCount?: number;
}

/**
 * Pre-resolved slugs to avoid redundant Claude API calls
 *
 * @description
 * When slugs are already resolved (e.g., in Step 2 of the MDX pipeline),
 * pass them here to skip redundant slug resolution in subsequent steps.
 *
 * @example
 * ```typescript
 * const resolvedSlugs: ResolvedSlugs = {
 *   workSlug: "jujutsu-kaisen",
 *   storeSlug: "avail",
 *   eventType: "collabo-cafe"
 * };
 * ```
 */
export interface ResolvedSlugs {
  /**
   * Work slug (romanized anime/manga title)
   * @example "jujutsu-kaisen"
   */
  workSlug: string;

  /**
   * Store slug (brand/cafe name)
   * @example "avail", "animate-cafe"
   */
  storeSlug: string;

  /**
   * Event type slug
   * @example "collabo-cafe", "pop-up-store"
   */
  eventType: string;
}

/**
 * Input parameters for creating a new event canonical key
 */
export interface CreateEventCanonicalKeyInput {
  /**
   * Work title in Japanese (e.g., "呪術廻戦")
   */
  workTitle: string;

  /**
   * Store/brand name in Japanese (e.g., "アニメイトカフェ")
   */
  storeName: string;

  /**
   * Event type name in Japanese (e.g., "コラボカフェ")
   */
  eventTypeName: string;

  /**
   * Event year (defaults to current year if not provided)
   */
  year?: number;

  /**
   * Optional: Post ID (generated if not provided)
   */
  postId?: string;

  /**
   * Optional: Pre-resolved slugs to avoid redundant Claude API calls
   *
   * @description
   * If slugs are already resolved (e.g., in MDX pipeline Step 2),
   * pass them here to skip slug resolution in checkEventDuplication/registerNewEvent.
   * This optimization reduces Claude API costs and improves performance.
   */
  resolvedSlugs?: ResolvedSlugs;
}

/**
 * Result of duplication check
 */
export interface DuplicationCheckResult {
  /**
   * Whether the event already exists
   */
  isDuplicate: boolean;

  /**
   * Existing document if duplicate found
   */
  existingDoc?: EventCanonicalKey;

  /**
   * Canonical key that was checked
   */
  canonicalKey: string;
}

/**
 * Canonical Key Format Components
 */
export interface CanonicalKeyComponents {
  workSlug: string;
  storeSlug: string;
  eventType: string;
  year: number;
}

/**
 * Firestore collection names
 */
export const FIRESTORE_COLLECTIONS = {
  EVENT_CANONICAL_KEYS: 'event_canonical_keys',
} as const;
