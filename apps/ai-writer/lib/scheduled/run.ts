/**
 * One scheduled run: order the candidates and send them through the pipeline one by one
 * (ADR-0003, details decided 2026-11-15).
 *
 * A run stops at the first of:
 * - 5 article PRs
 * - 15 candidates tried
 * - 90 minutes since the start (the job's task timeout is 2 hours, so the last attempt and the
 *   notification still fit)
 * - 3 failures in a row: most likely an outage (an expired key, no credits) rather than three
 *   bad pages. Those 3 failures do not count toward each URL's retry limit
 *
 * Candidates left over are tried by a later run. In a dry run nothing is written: no PR, no
 * Firestore record (the pipeline's own `dryRun` skips the rest).
 *
 * Dependencies are passed in so the loop can be tested without Firestore, the network or AI.
 *
 * @module lib/scheduled/run
 */
import type { MdxGenerationRequest, MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import { buildAttemptRecord, toAttemptOutcome, type AttemptResult } from './attempt-record';
import type { AttemptRecord } from './attempt-store';
import { orderCandidates, type Candidate, type RssCandidateInput } from './candidates';
import { extractPublishedDate } from './published-date';
import { normalizeAttemptUrl } from './url-key';

export const MAX_PRS_PER_RUN = 5;
export const MAX_TRIES_PER_RUN = 15;
export const RUN_TIME_BUDGET_MS = 90 * 60 * 1000;
export const MAX_CONSECUTIVE_FAILURES = 3;
/** How many due retries to read. More than a run can try, so the order is decided here */
const DUE_RETRY_READ_LIMIT = 50;

export interface FetchedPage {
  title: string;
  /** The article block passed to the pipeline */
  html: string;
  /** The URL after unwrapping redirects */
  actualUrl: string;
  /** The whole page, for the publish date */
  pageHtml: string;
}

export interface ScheduledRunDeps {
  now: () => Date;
  store: {
    get(url: string): Promise<AttemptRecord | undefined>;
    findAttempted(urls: string[]): Promise<Set<string>>;
    findDueRetries(now: Date, limit: number): Promise<AttemptRecord[]>;
    save(record: AttemptRecord): Promise<void>;
  };
  /** RSS items of the active feeds. A feed that cannot be read is reported in `errors` */
  loadRssItems: () => Promise<{ items: RssCandidateInput[]; errors: string[] }>;
  fetchPage: (url: string) => Promise<FetchedPage>;
  generate: (request: MdxGenerationRequest) => Promise<MdxGenerationResult>;
  log?: (message: string) => void;
}

export type StopReason = 'max-prs' | 'max-tries' | 'time-budget' | 'consecutive-failures';

export interface RunItem {
  url: string;
  title?: string;
  source: Candidate['source'];
  outcome: 'pr' | 'skipped' | 'unannounced' | 'failure';
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
  prCount: number;
  candidateCount: number;
  stopReason?: StopReason;
  /** Feeds that could not be read */
  feedErrors: string[];
}

interface PendingFailure {
  candidate: Candidate;
  previous: AttemptRecord | undefined;
  attempt: AttemptResult;
  pageDate: ReturnType<typeof extractPublishedDate>;
  now: Date;
  item: RunItem;
}

export interface RunOptions {
  dryRun: boolean;
  /** A smaller try limit for checking a dry run by hand (default `MAX_TRIES_PER_RUN`) */
  maxTries?: number;
}

export async function runScheduled(deps: ScheduledRunDeps, options: RunOptions): Promise<ScheduledRunSummary> {
  const maxTries = Math.min(options.maxTries ?? MAX_TRIES_PER_RUN, MAX_TRIES_PER_RUN);
  const log = deps.log ?? (() => {});
  const startedAt = deps.now();

  const [{ items: rssItems, errors: feedErrors }, dueRecords] = await Promise.all([
    deps.loadRssItems(),
    deps.store.findDueRetries(startedAt, DUE_RETRY_READ_LIMIT),
  ]);
  const attemptedUrls = await deps.store.findAttempted(rssItems.map(item => normalizeAttemptUrl(item.link)));
  const candidates = orderCandidates({
    dueRetries: dueRecords.flatMap(record =>
      record.nextAttemptAt
        ? [{ url: record.url, title: record.title, feedId: record.feedId, nextAttemptAt: record.nextAttemptAt }]
        : [],
    ),
    rssItems,
    attemptedUrls,
    now: startedAt,
  });
  log(`候補 ${candidates.length} 件 (試し直し ${dueRecords.length} 件、RSS ${rssItems.length} 件、読めなかったフィード ${feedErrors.length} 件)`);

  const items: RunItem[] = [];
  let prCount = 0;
  let stopReason: StopReason | undefined;
  let pendingFailures: PendingFailure[] = [];

  /** Save the held failures. They count toward the retry limit unless the run hit an outage */
  const flushFailures = async (counted: boolean) => {
    for (const pending of pendingFailures) {
      const record = buildAttemptRecord(
        pending.previous,
        {
          url: pending.candidate.url,
          source: 'rss',
          feedId: pending.candidate.feedId,
          title: pending.candidate.title,
          pageDate: pending.pageDate,
          rssPubDate: pending.candidate.rssPubDate,
          now: pending.now,
          countFailure: counted,
        },
        pending.attempt,
      );
      pending.item.nextAttemptAt = record.nextAttemptAt;
      pending.item.givenUpReason = record.givenUpReason;
      if (!options.dryRun) await deps.store.save(record);
    }
    pendingFailures = [];
  };

  for (const candidate of candidates) {
    if (prCount >= MAX_PRS_PER_RUN) {
      stopReason = 'max-prs';
      break;
    }
    if (items.length >= maxTries) {
      stopReason = 'max-tries';
      break;
    }
    const now = deps.now();
    if (now.getTime() - startedAt.getTime() >= RUN_TIME_BUDGET_MS) {
      stopReason = 'time-budget';
      break;
    }

    log(`[${items.length + 1}] ${candidate.url}`);
    const previous = await deps.store.get(candidate.url);

    let attempt: AttemptResult;
    let pageDate: ReturnType<typeof extractPublishedDate> = undefined;
    try {
      const page = await deps.fetchPage(candidate.url);
      pageDate = extractPublishedDate(page.pageHtml, now);
      log(
        pageDate
          ? `  公開日: ${pageDate.date.toISOString()} (${pageDate.source})`
          : `  公開日: ページから読めず (${candidate.rssPubDate ? `RSS の配信日 ${candidate.rssPubDate.toISOString()}` : '初めて試した日'} を使う)`,
      );
      const result = await deps.generate({
        rssItem: {
          title: page.title,
          link: page.actualUrl,
          content: page.html,
          contentSnippet: page.html.substring(0, 500),
          pubDate: (candidate.rssPubDate ?? now).toISOString(),
        },
        dryRun: options.dryRun,
      });
      attempt = { kind: 'pipeline', result };
    } catch (error) {
      attempt = { kind: 'error', error: error instanceof Error ? error.message : String(error) };
    }

    const outcome = toAttemptOutcome(attempt, true);
    const result = attempt.kind === 'pipeline' ? attempt.result : undefined;
    const item: RunItem = {
      url: candidate.url,
      title: candidate.title,
      source: candidate.source,
      outcome: outcome.kind,
      reason: attempt.kind === 'error' ? attempt.error : result?.skipped ? result.skipReason : result?.error,
      prUrl: result?.prResult?.prUrl,
    };
    items.push(item);

    if (outcome.kind === 'failure') {
      pendingFailures.push({ candidate, previous, attempt, pageDate, now, item });
      if (pendingFailures.length >= MAX_CONSECUTIVE_FAILURES) {
        await flushFailures(false);
        stopReason = 'consecutive-failures';
        break;
      }
      continue;
    }

    await flushFailures(true);
    if (outcome.kind === 'pr') prCount++;
    const record = buildAttemptRecord(
      previous,
      {
        url: candidate.url,
        source: 'rss',
        feedId: candidate.feedId,
        title: candidate.title,
        pageDate,
        rssPubDate: candidate.rssPubDate,
        now,
        countFailure: true,
      },
      attempt,
    );
    item.nextAttemptAt = record.nextAttemptAt;
    item.givenUpReason = record.givenUpReason;
    if (!options.dryRun) await deps.store.save(record);
  }
  await flushFailures(true);

  return {
    dryRun: options.dryRun,
    startedAt,
    finishedAt: deps.now(),
    items,
    prCount,
    candidateCount: candidates.length,
    stopReason,
    feedErrors,
  };
}
