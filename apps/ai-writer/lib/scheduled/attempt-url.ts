/**
 * The key a scheduled run uses to tell whether a URL was already tried.
 *
 * The rules live in `@revolution/net/attempt-url`, shared with the WEB checker, which hands
 * detected links to scheduled runs under the same document IDs. This module re-exports them so
 * the imports in ai-writer stay as they are.
 *
 * @module lib/scheduled/attempt-url
 */
export { attemptDocId, normalizeAttemptUrl } from '@revolution/net/attempt-url';
