/**
 * The limits of a scheduled run and the shape of its summary.
 *
 * Kept apart from `run.ts` so the Slack message can use them without loading the run itself
 * (the page parser, the pipeline types and so on).
 *
 * @module lib/scheduled/summary
 */
import type { OutcomeKind } from './retry-policy';

export const MAX_PRS_PER_RUN = 5;
export const MAX_TRIES_PER_RUN = 15;
export const RUN_TIME_BUDGET_MINUTES = 90;
export const MAX_CONSECUTIVE_FAILURES = 3;

export type StopReason = 'max-prs' | 'max-tries' | 'time-budget' | 'consecutive-failures' | 'error';

export interface RunItem {
  url: string;
  /** Registered by hand from the admin UI (its first try or a retry) */
  registered: boolean;
  /** A link the WEB checker handed over (its first try or a retry) */
  detected?: boolean;
  title?: string;
  outcome: OutcomeKind;
  /** The skip reason or the error */
  reason?: string;
  prUrl?: string;
  /** When the URL will be tried again (unannounced / failure) */
  nextAttemptAt?: Date | null;
  /** Set when this attempt ended the retries */
  givenUpReason?: string;
}

export interface ScheduledRunSummary {
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
  items: RunItem[];
  candidateCount: number;
  stopReason?: StopReason;
  /** The error that stopped the run (`stopReason` is `error`) */
  error?: string;
  /** Feeds that could not be read */
  feedErrors: string[];
}

/** How many article PRs (or, in a dry run, articles that could be written) the run made */
export function prCountOf(summary: Pick<ScheduledRunSummary, 'items'>): number {
  return summary.items.filter(item => item.outcome === 'pr').length;
}
