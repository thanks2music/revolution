/**
 * Event Deduplication Module
 *
 * Purpose:
 *   - Prevent duplicate article generation using Firestore
 *   - Manage event canonical keys and status tracking
 *   - Support retry logic for failed generations
 *
 * @module lib/firestore/event-deduplication
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../firebase/admin'; // Firebase Admin SDK初期化用
import { generateSlugWithYear } from '../ulid/generate-post-id';
import { generateCanonicalKeyFromNames } from './canonical-key';
import type {
  EventCanonicalKey,
  EventStatus,
  CreateEventCanonicalKeyInput,
  DuplicationCheckResult,
} from './types';
import { FIRESTORE_COLLECTIONS } from './types';

/**
 * Checks if an event already exists in Firestore
 *
 * @description
 * Queries Firestore using the canonical key to determine if
 * an article has already been generated for this event
 *
 * @param {CreateEventCanonicalKeyInput} input - Event information
 * @returns {Promise<DuplicationCheckResult>} Check result
 *
 * @example
 * ```typescript
 * const result = await checkEventDuplication({
 *   workTitle: "呪術廻戦",
 *   storeName: "BOX cafe&space",
 *   eventTypeName: "コラボカフェ",
 *   year: 2025
 * });
 *
 * if (result.isDuplicate) {
 *   console.log("Event already exists:", result.existingDoc);
 * } else {
 *   console.log("New event, can proceed");
 * }
 * ```
 */
export async function checkEventDuplication(
  input: CreateEventCanonicalKeyInput
): Promise<DuplicationCheckResult> {
  const { workTitle, storeName, eventTypeName, resolvedSlugs } = input;
  const year = input.year || new Date().getFullYear();

  // Generate canonical key (use pre-resolved slugs if available)
  let canonicalKey: string;

  if (resolvedSlugs) {
    // Use pre-resolved slugs to avoid redundant Claude API calls
    const { workSlug, storeSlug, eventType } = resolvedSlugs;
    canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;
  } else {
    // Fallback: resolve slugs from Japanese names
    const result = await generateCanonicalKeyFromNames(
      workTitle,
      storeName,
      eventTypeName,
      year
    );
    canonicalKey = result.canonicalKey;
  }

  // Query Firestore (getAdminDb()を呼ぶことで初期化を確実に実行)
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  const docSnapshot = await docRef.get();

  if (!docSnapshot.exists) {
    return {
      isDuplicate: false,
      canonicalKey,
    };
  }

  const existingDoc = docSnapshot.data() as EventCanonicalKey;

  // Consider it a duplicate only if status is 'generated'
  // 'pending', 'failed', or 'retryable' can be overwritten
  const isDuplicate = existingDoc.status === 'generated';

  return {
    isDuplicate,
    existingDoc,
    canonicalKey,
  };
}

/**
 * Registers a new event in Firestore
 *
 * @description
 * Creates a new event canonical key document with 'pending' status
 * Should be called before starting article generation
 *
 * @param {CreateEventCanonicalKeyInput} input - Event information
 * @returns {Promise<EventCanonicalKey>} Created document
 *
 * @example
 * ```typescript
 * const doc = await registerNewEvent({
 *   workTitle: "呪術廻戦",
 *   storeName: "BOX cafe&space",
 *   eventTypeName: "コラボカフェ",
 *   year: 2025
 * });
 * console.log(doc.canonicalKey); // "jujutsu-kaisen:avail:collabo-cafe:2025"
 * console.log(doc.status); // "pending"
 * ```
 *
 * @throws {Error} If event already exists with 'generated' status
 */
export async function registerNewEvent(
  input: CreateEventCanonicalKeyInput
): Promise<EventCanonicalKey> {
  const { workTitle, storeName, eventTypeName, resolvedSlugs } = input;
  const year = input.year || new Date().getFullYear();

  // Check for duplicates first (pass resolved slugs if available)
  const duplicationCheck = await checkEventDuplication({
    workTitle,
    storeName,
    eventTypeName,
    year,
    resolvedSlugs,
  });

  if (duplicationCheck.isDuplicate) {
    throw new Error(
      `Event already exists: ${duplicationCheck.canonicalKey}. ` +
        `Status: ${duplicationCheck.existingDoc?.status}`
    );
  }

  // Generate canonical key and components (use pre-resolved slugs if available)
  let canonicalKey: string;
  let workSlug: string;
  let storeSlug: string;
  let eventType: string;

  if (resolvedSlugs) {
    // Use pre-resolved slugs to avoid redundant Claude API calls
    workSlug = resolvedSlugs.workSlug;
    storeSlug = resolvedSlugs.storeSlug;
    eventType = resolvedSlugs.eventType;
    canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;
  } else {
    // Fallback: resolve slugs from Japanese names
    const result = await generateCanonicalKeyFromNames(
      workTitle,
      storeName,
      eventTypeName,
      year
    );
    canonicalKey = result.canonicalKey;
    workSlug = result.components.workSlug;
    storeSlug = result.components.storeSlug;
    eventType = result.components.eventType;
  }

  // Generate post ID
  const postId = input.postId || generateSlugWithYear(year);

  // Create document
  const now = Timestamp.now();
  const doc: EventCanonicalKey = {
    canonicalKey,
    workSlug,
    storeSlug,
    eventType,
    year,
    postId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
  };

  // Save to Firestore
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  await docRef.set(doc);

  return doc;
}

/**
 * Updates the status of an event
 *
 * @description
 * Updates the status field and updatedAt timestamp
 * Used to mark article generation as completed or failed
 *
 * @param {string} canonicalKey - Event canonical key
 * @param {EventStatus} status - New status
 * @param {string} errorMessage - Optional error message for failed status
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * // Mark as successfully generated
 * await updateEventStatus(
 *   "jujutsu-kaisen:avail:collabo-cafe:2025",
 *   "generated"
 * );
 *
 * // Mark as failed with error message
 * await updateEventStatus(
 *   "jujutsu-kaisen:avail:collabo-cafe:2025",
 *   "failed",
 *   "Claude API timeout"
 * );
 * ```
 */
export async function updateEventStatus(
  canonicalKey: string,
  status: EventStatus,
  errorMessage?: string
): Promise<void> {
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  const updateData: Partial<EventCanonicalKey> = {
    status,
    updatedAt: Timestamp.now(),
  };

  if (errorMessage) {
    updateData.errorMessage = errorMessage;
  }

  await docRef.update(updateData);
}

/**
 * Increments the retry count for a failed event
 *
 * @description
 * Increments retryCount and updates status to 'retryable'
 * Used when article generation fails but can be retried
 *
 * @param {string} canonicalKey - Event canonical key
 * @param {string} errorMessage - Error message
 * @returns {Promise<number>} New retry count
 *
 * @example
 * ```typescript
 * const retryCount = await incrementRetryCount(
 *   "jujutsu-kaisen:avail:collabo-cafe:2025",
 *   "Network timeout"
 * );
 * console.log(`Retry count: ${retryCount}`);
 * ```
 */
export async function incrementRetryCount(
  canonicalKey: string,
  errorMessage: string
): Promise<number> {
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  const docSnapshot = await docRef.get();
  if (!docSnapshot.exists) {
    throw new Error(`Event not found: ${canonicalKey}`);
  }

  const doc = docSnapshot.data() as EventCanonicalKey;
  const newRetryCount = (doc.retryCount || 0) + 1;

  await docRef.update({
    retryCount: newRetryCount,
    status: 'retryable',
    errorMessage,
    updatedAt: Timestamp.now(),
  });

  return newRetryCount;
}

/**
 * Gets an event document by canonical key
 *
 * @param {string} canonicalKey - Event canonical key
 * @returns {Promise<EventCanonicalKey | null>} Event document or null if not found
 *
 * @example
 * ```typescript
 * const event = await getEventByCanonicalKey(
 *   "jujutsu-kaisen:avail:collabo-cafe:2025"
 * );
 * if (event) {
 *   console.log(event.status);
 * }
 * ```
 */
export async function getEventByCanonicalKey(
  canonicalKey: string
): Promise<EventCanonicalKey | null> {
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  const docSnapshot = await docRef.get();
  if (!docSnapshot.exists) {
    return null;
  }

  return docSnapshot.data() as EventCanonicalKey;
}

/**
 * Deletes an event document (for testing/cleanup only)
 *
 * @param {string} canonicalKey - Event canonical key
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * await deleteEvent("jujutsu-kaisen:avail:collabo-cafe:2025");
 * ```
 *
 * @internal Use only for testing or manual cleanup
 */
export async function deleteEvent(canonicalKey: string): Promise<void> {
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const docRef = db.collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS).doc(canonicalKey);

  await docRef.delete();
}

/**
 * Queries events by status
 *
 * @param {EventStatus} status - Status to filter by
 * @param {number} limit - Maximum number of results (default: 100)
 * @returns {Promise<EventCanonicalKey[]>} Array of events
 *
 * @example
 * ```typescript
 * // Get all pending events
 * const pendingEvents = await queryEventsByStatus("pending");
 *
 * // Get failed events for retry
 * const failedEvents = await queryEventsByStatus("retryable", 50);
 * ```
 */
export async function queryEventsByStatus(
  status: EventStatus,
  limit = 100
): Promise<EventCanonicalKey[]> {
  getAdminDb(); // Firebase Admin SDK初期化
  const db = getFirestore();
  const querySnapshot = await db
    .collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS)
    .where('status', '==', status)
    .limit(limit)
    .get();

  return querySnapshot.docs.map(doc => doc.data() as EventCanonicalKey);
}
