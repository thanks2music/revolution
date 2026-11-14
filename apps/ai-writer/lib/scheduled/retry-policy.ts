/**
 * When a scheduled run tries a URL again, and when it gives up (decided 2026-11-15).
 *
 * - A PR, or a skip for any reason other than "details not announced yet", ends the URL.
 *   It is never tried again (an existing article, an out-of-scope page and so on do not change).
 * - "Details not announced yet" (A-1-c) is tried again:
 *   - if the page was less than 7 days old when it was first tried: once a week later,
 *     then every 3 days
 *   - otherwise: every 3 days
 *   - stop at the event's start date. Without a known start date, stop 60 days after the page
 *     was published (and switch to the start date as soon as one becomes known)
 * - A failure (network, AI, GitHub ...) is tried again on the next run, up to 3 failures in
 *   total. A failure that is part of a run-wide outage (several failures in a row) does not
 *   count, because the URL itself is not the problem. Only the first failure of a URL's streak
 *   can be excused; the following ones count.
 *
 * Pure functions only; the Firestore side is `attempt-store.ts`.
 *
 * @module lib/scheduled/retry-policy
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const FIRST_RETRY_DAYS_FOR_FRESH_PAGE = 7;
export const RETRY_INTERVAL_DAYS = 3;
export const FRESH_PAGE_MAX_AGE_DAYS = 7;
export const UNANNOUNCED_GIVE_UP_DAYS = 60;
export const MAX_COUNTED_FAILURES = 3;

/** Where a URL stands after an attempt */
export type AttemptStatus =
  /** Ended: a PR was made, or it was skipped for a reason that will not change */
  | 'done'
  /** Details not announced yet; tried again at `nextAttemptAt` */
  | 'waiting-details'
  /** Failed; tried again at `nextAttemptAt` */
  | 'retrying-failure'
  /** Ended without an article after the retries ran out */
  | 'given-up';

/** What the pipeline returned for one attempt */
export type AttemptOutcome =
  | { kind: 'pr' }
  | { kind: 'skipped' }
  | { kind: 'unannounced'; eventStartDate?: string }
  | { kind: 'failure'; counted: boolean };

/** The parts of the stored record the policy needs */
export interface PreviousAttempt {
  firstAttemptAt: Date;
  unannouncedCount: number;
  failureCount: number;
  eventStartDate?: string;
  /** What the last attempt ended in (`attempt-store.ts` `LastOutcome`) */
  lastOutcome?: string;
}

export interface NextAttemptState {
  status: AttemptStatus;
  nextAttemptAt: Date | null;
  unannouncedCount: number;
  failureCount: number;
  eventStartDate?: string;
  /** Why the URL was given up (only when `status` is `given-up`) */
  givenUpReason?: string;
}

/** `YYYY-MM-DD` (a day in Japan) to the moment that day starts */
export function startOfJstDay(isoDate: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
  const date = new Date(`${isoDate}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Work out the state after an attempt.
 *
 * @param previous the stored record, or `undefined` for the first attempt
 * @param outcome  what this attempt returned
 * @param now      when this attempt ran
 * @param publishedAt when the page was published (page date, RSS date or registration date)
 */
export function nextAttemptState(
  previous: PreviousAttempt | undefined,
  outcome: AttemptOutcome,
  now: Date,
  publishedAt: Date,
): NextAttemptState {
  const unannouncedCount = previous?.unannouncedCount ?? 0;
  const failureCount = previous?.failureCount ?? 0;
  const eventStartDate = previous?.eventStartDate;
  const base = { unannouncedCount, failureCount, eventStartDate };

  switch (outcome.kind) {
    case 'pr':
    case 'skipped':
      return { ...base, status: 'done', nextAttemptAt: null };

    case 'failure': {
      // Only the first failure of a URL's streak can be excused. Otherwise URLs that always fail
      // would keep each other at the front of the queue (retries go first), stop every run as an
      // "outage" and never be given up
      const excused = !outcome.counted && previous?.lastOutcome !== 'failure';
      const count = excused ? failureCount : failureCount + 1;
      if (count >= MAX_COUNTED_FAILURES) {
        return {
          ...base,
          failureCount: count,
          status: 'given-up',
          nextAttemptAt: null,
          givenUpReason: `${MAX_COUNTED_FAILURES} 回失敗したため打ち切りました`,
        };
      }
      // The next run picks it up again
      return { ...base, failureCount: count, status: 'retrying-failure', nextAttemptAt: now };
    }

    case 'unannounced': {
      const count = unannouncedCount + 1;
      const startDate = outcome.eventStartDate ?? eventStartDate;
      const firstAttemptAt = previous?.firstAttemptAt ?? now;
      const ageAtFirstAttempt = firstAttemptAt.getTime() - publishedAt.getTime();
      const freshPage = ageAtFirstAttempt < FRESH_PAGE_MAX_AGE_DAYS * DAY_MS;
      const interval =
        freshPage && count === 1 ? FIRST_RETRY_DAYS_FOR_FRESH_PAGE : RETRY_INTERVAL_DAYS;
      const next = addDays(now, interval);

      const startAt = startDate ? startOfJstDay(startDate) : undefined;
      const deadline = startAt ?? addDays(publishedAt, UNANNOUNCED_GIVE_UP_DAYS);
      const state = { unannouncedCount: count, failureCount, eventStartDate: startDate };

      // The next try would fall on or after the deadline, so there is no try left
      if (next.getTime() >= deadline.getTime()) {
        return {
          ...state,
          status: 'given-up',
          nextAttemptAt: null,
          givenUpReason: startAt
            ? `開始日 (${startDate}) までに詳細が発表されなかったため打ち切りました`
            : `公開から ${UNANNOUNCED_GIVE_UP_DAYS} 日以内に詳細が発表されなかったため打ち切りました`,
        };
      }
      return { ...state, status: 'waiting-details', nextAttemptAt: next };
    }
  }
}
