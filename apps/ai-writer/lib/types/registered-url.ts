/**
 * What the registered URL API returns to the admin UI (dates as ISO strings).
 *
 * Kept free of server imports so the client page can use it.
 */

/** Where a URL stands after an attempt (`AttemptStatus` in `lib/scheduled/retry-policy.ts`) */
export type RegisteredUrlStatus = 'done' | 'waiting-details' | 'retrying-failure' | 'given-up';

/** What the last attempt ended in (`OutcomeKind` in `lib/scheduled/retry-policy.ts`) */
export type RegisteredUrlOutcome = 'pr' | 'skipped' | 'unannounced' | 'failure';

export interface RegisteredUrlAttemptView {
  status: RegisteredUrlStatus;
  lastOutcome: RegisteredUrlOutcome;
  /** The page title, once the page was read */
  title?: string;
  /** The skip reason or the error of the last attempt */
  lastReason?: string;
  prUrl?: string;
  attemptCount: number;
  lastAttemptAt: string;
  nextAttemptAt: string | null;
  givenUpReason?: string;
}

export interface RegisteredUrlView {
  id: string;
  url: string;
  createdBy: string;
  createdAt: string;
  /** Absent until the scheduled run tries the URL */
  attempt?: RegisteredUrlAttemptView;
}
