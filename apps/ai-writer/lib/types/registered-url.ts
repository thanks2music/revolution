/**
 * What the registered URL API returns to the admin UI (dates as ISO strings).
 *
 * Only type imports, so the client page can use it.
 */
import type { AttemptStatus, OutcomeKind } from '@/lib/scheduled/retry-policy';

export interface RegisteredUrlAttemptView {
  status: AttemptStatus;
  lastOutcome: OutcomeKind;
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
