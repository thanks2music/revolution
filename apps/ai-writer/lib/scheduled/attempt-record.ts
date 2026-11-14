/**
 * Turn the result of one attempt into the record to store (pure).
 *
 * @module lib/scheduled/attempt-record
 */
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import type { AttemptRecord, AttemptSource, LastOutcome, PublishedAtSource } from './attempt-store';
import type { PublishedDate } from './published-date';
import { nextAttemptState, type AttemptOutcome } from './retry-policy';

/** What one attempt produced. `result` is absent when the attempt threw before the pipeline ran */
export type AttemptResult =
  | { kind: 'pipeline'; result: MdxGenerationResult }
  | { kind: 'error'; error: string };

export interface AttemptContext {
  url: string;
  source: AttemptSource;
  feedId?: string;
  title?: string;
  /** The date read from the page (when the page was fetched) */
  pageDate?: PublishedDate;
  /** The RSS delivery date (RSS items only) */
  rssPubDate?: Date;
  now: Date;
  /**
   * Whether a failure counts toward the 3-failure limit. A failure inside a run-wide outage
   * (several failures in a row) does not count
   */
  countFailure: boolean;
}

/** Map an attempt onto the retry policy's outcome */
export function toAttemptOutcome(attempt: AttemptResult, countFailure: boolean): AttemptOutcome {
  if (attempt.kind === 'error') return { kind: 'failure', counted: countFailure };
  const { result } = attempt;
  // A skip comes back as `success: false, skipped: true`, so check `skipped` first
  if (result.skipped) {
    return result.skipKind === 'unannounced-event'
      ? { kind: 'unannounced', eventStartDate: result.eventStartDate }
      : { kind: 'skipped' };
  }
  if (!result.success) return { kind: 'failure', counted: countFailure };
  return { kind: 'pr' };
}

const LAST_OUTCOME: Record<AttemptOutcome['kind'], LastOutcome> = {
  pr: 'pr',
  skipped: 'skipped',
  unannounced: 'unannounced',
  failure: 'failure',
};

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
  return { publishedAt: context.now, publishedAtSource: 'first-attempt' };
}

export function buildAttemptRecord(
  previous: AttemptRecord | undefined,
  context: AttemptContext,
  attempt: AttemptResult,
): AttemptRecord {
  const outcome = toAttemptOutcome(attempt, context.countFailure);
  const { publishedAt, publishedAtSource } = publishedAtOf(previous, context);
  const state = nextAttemptState(previous, outcome, context.now, publishedAt);

  const result = attempt.kind === 'pipeline' ? attempt.result : undefined;
  const lastReason =
    attempt.kind === 'error' ? attempt.error : result?.skipped ? result.skipReason : result?.error;

  return {
    url: context.url,
    source: previous?.source ?? context.source,
    feedId: previous?.feedId ?? context.feedId,
    title: context.title ?? previous?.title,
    status: state.status,
    lastOutcome: LAST_OUTCOME[outcome.kind],
    lastReason,
    prUrl: result?.prResult?.prUrl ?? previous?.prUrl,
    postId: result?.details?.postId ?? previous?.postId,
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
