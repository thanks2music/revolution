/**
 * Firestore Module Entry Point
 *
 * @module lib/firestore
 */

// Export types
export type {
  EventStatus,
  EventCanonicalKey,
  CreateEventCanonicalKeyInput,
  DuplicationCheckResult,
  CanonicalKeyComponents,
} from './types';
export { FIRESTORE_COLLECTIONS } from './types';

// Export canonical key functions
export {
  generateCanonicalKey,
  generateCanonicalKeyFromNames,
  parseCanonicalKey,
  isValidCanonicalKey,
} from './canonical-key';

// Export event deduplication functions
export {
  checkEventDuplication,
  registerNewEvent,
  updateEventStatus,
  incrementRetryCount,
  getEventByCanonicalKey,
  deleteEvent,
  queryEventsByStatus,
} from './event-deduplication';
