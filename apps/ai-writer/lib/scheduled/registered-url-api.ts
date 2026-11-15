/**
 * Shared by the registered URL API routes: the stores behind them and the shape they return.
 *
 * @module lib/scheduled/registered-url-api
 */
import { getAdminDb } from '@/lib/firebase/admin';
import type { RegisteredUrlAttemptView, RegisteredUrlView } from '@/lib/types/registered-url';
import { assertPublicHost } from '@/lib/utils/safe-image-fetch';

import { AttemptStore, type AttemptRecord } from './attempt-store';
import { RegisteredUrlStore, type RegisteredUrl } from './registered-url-store';
import type { RegisteredUrlDeps } from './registered-urls';

export function registeredUrlDeps(): RegisteredUrlDeps {
  const db = getAdminDb();
  return { registered: new RegisteredUrlStore(db), attempts: new AttemptStore(db), assertPublicHost };
}

export function toAttemptView(attempt: AttemptRecord): RegisteredUrlAttemptView {
  return {
    status: attempt.status,
    lastOutcome: attempt.lastOutcome,
    title: attempt.title,
    lastReason: attempt.lastReason,
    prUrl: attempt.prUrl,
    attemptCount: attempt.attemptCount,
    lastAttemptAt: attempt.lastAttemptAt.toISOString(),
    nextAttemptAt: attempt.nextAttemptAt ? attempt.nextAttemptAt.toISOString() : null,
    givenUpReason: attempt.givenUpReason,
  };
}

export function toRegisteredUrlView(entry: RegisteredUrl & { attempt?: AttemptRecord }): RegisteredUrlView {
  return {
    id: entry.id,
    url: entry.url,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
    attempt: entry.attempt ? toAttemptView(entry.attempt) : undefined,
  };
}
