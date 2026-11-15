/**
 * Turn the result of one attempt into the record to store (pure).
 *
 * @module lib/scheduled/attempt-record
 */
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import type { AttemptRecord, AttemptSource, PublishedAtSource } from './attempt-store';
import type { PublishedDate } from './published-date';
import { nextAttemptState, type AttemptOutcome } from './retry-policy';

/** What one attempt produced: the pipeline's result, or the error thrown before it returned */
export type AttemptResult =
  | { kind: 'pipeline'; result: MdxGenerationResult }
  | { kind: 'error'; error: string };

/** What is known about the URL when it is tried */
export interface AttemptContext {
  url: string;
  source: AttemptSource;
  feedId?: string;
  title?: string;
  /** The date read from the page (when the page was fetched) */
  pageDate?: PublishedDate;
  /** The RSS delivery date (RSS items only) */
  rssPubDate?: Date;
  /** When the URL was registered (registered URLs only) */
  registeredAt?: Date;
  now: Date;
}

/** Map an attempt onto the retry policy's outcome */
export function toAttemptOutcome(attempt: AttemptResult, countFailure: boolean): AttemptOutcome {
  if (attempt.kind === 'error') return { kind: 'failure', counted: countFailure };
  const { result } = attempt;
  // The pipeline returns some step errors as skips (detail extraction, content generation);
  // they are failures here, so a passing outage does not drop the article for good
  if (result.skipped && result.skipKind === 'step-error') return { kind: 'failure', counted: countFailure };
  // A skip comes back as `success: false, skipped: true`, so check `skipped` before `success`
  if (result.skipped) {
    return result.skipKind === 'unannounced-event'
      ? { kind: 'unannounced', eventStartDate: result.eventStartDate }
      : { kind: 'skipped' };
  }
  if (!result.success) return { kind: 'failure', counted: countFailure };
  return { kind: 'pr' };
}

/** The skip reason or the error of an attempt, and its PR (what the record and Slack show) */
export function describeAttempt(attempt: AttemptResult): { reason?: string; prUrl?: string } {
  if (attempt.kind === 'error') return { reason: attempt.error };
  const { result } = attempt;
  return { reason: result.skipped ? result.skipReason : result.error, prUrl: result.prResult?.prUrl };
}

/**
 * The publish date used for the retry schedule. It is fixed on the first attempt, so the
 * schedule does not move when a page later shows a different date.
 */
function publishedAtOf(
  previous: AttemptRecord | undefined,
  context: AttemptContext,
): { publishedAt: Date; publishedAtSource: PublishedAtSource } {
  if (previous) return { publishedAt: previous.publishedAt, publishedAtSource: previous.publishedAtSource };
  if (context.pageDate) return { publishedAt: context.pageDate.date, publishedAtSource: context.pageDate.source };
  if (context.rssPubDate) return { publishedAt: context.rssPubDate, publishedAtSource: 'rss' };
  if (context.registeredAt) return { publishedAt: context.registeredAt, publishedAtSource: 'registration' };
  return { publishedAt: context.now, publishedAtSource: 'first-attempt' };
}

/**
 * @param countFailure whether a failure counts toward the 3-failure limit. A failure inside a
 *   run-wide outage (several failures in a row) does not count
 */
export function buildAttemptRecord(
  previous: AttemptRecord | undefined,
  context: AttemptContext,
  attempt: AttemptResult,
  countFailure: boolean,
): AttemptRecord {
  const outcome = toAttemptOutcome(attempt, countFailure);
  const { publishedAt, publishedAtSource } = publishedAtOf(previous, context);
  const state = nextAttemptState(previous, outcome, context.now, publishedAt);
  const { reason, prUrl } = describeAttempt(attempt);
  const postId = attempt.kind === 'pipeline' ? attempt.result.details?.postId : undefined;

  return {
    url: context.url,
    source: previous?.source ?? context.source,
    feedId: previous?.feedId ?? context.feedId,
    title: context.title ?? previous?.title,
    status: state.status,
    lastOutcome: outcome.kind,
    lastReason: reason,
    prUrl: prUrl ?? previous?.prUrl,
    postId: postId ?? previous?.postId,
    attemptCount: (previous?.attemptCount ?? 0) + 1,
    unannouncedCount: state.unannouncedCount,
    failureCount: state.failureCount,
    firstAttemptAt: previous?.firstAttemptAt ?? context.now,
    lastAttemptAt: context.now,
    nextAttemptAt: state.nextAttemptAt,
    publishedAt,
    publishedAtSource,
    eventStartDate: state.eventStartDate,
    givenUpReason: state.givenUpReason,
  };
}
