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
 *   bad pages. Those failures do not count toward each URL's retry limit (`retry-policy.ts`)
 * - an error of the run itself (Firestore, reading the feeds): the summary still goes out with
 *   what was done
 *
 * Candidates left over are tried by a later run. In a dry run nothing is written: no PR, no
 * Firestore record (the pipeline's own `dryRun` skips the rest).
 *
 * Dependencies are passed in so the loop can be tested without Firestore, the network or AI.
 *
 * @module lib/scheduled/run
 */
import type { MdxGenerationRequest, MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import {
  buildAttemptRecord,
  describeAttempt,
  toAttemptOutcome,
  type AttemptContext,
  type AttemptResult,
} from './attempt-record';
import type { AttemptRecord, AttemptStore } from './attempt-store';
import { normalizeAttemptUrl } from './attempt-url';
import { orderCandidates, type Candidate, type RssCandidateInput } from './candidates';
import { extractPublishedDate } from './published-date';
import type { RegisteredUrl } from './registered-url-store';
import {
  MAX_CONSECUTIVE_FAILURES,
  MAX_PRS_PER_RUN,
  MAX_TRIES_PER_RUN,
  RUN_TIME_BUDGET_MINUTES,
  type RunItem,
  type ScheduledRunSummary,
  type StopReason,
} from './summary';

/** Shown when the record was given up while the run was trying the URL (`AttemptStore.save`) */
export const ALREADY_GIVEN_UP_REASON = '試している間に登録が取り消されたため、試し直しません';

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
  store: Pick<AttemptStore, 'findAttempted' | 'findDueRetries' | 'save'>;
  /** URLs registered by hand from the admin UI */
  loadRegisteredUrls: () => Promise<RegisteredUrl[]>;
  /** RSS items of the active feeds. A feed that cannot be read is reported in `errors` */
  loadRssItems: () => Promise<{ items: RssCandidateInput[]; errors: string[] }>;
  fetchPage: (url: string) => Promise<FetchedPage>;
  generate: (request: MdxGenerationRequest) => Promise<MdxGenerationResult>;
  log?: (message: string) => void;
}

export interface RunOptions {
  dryRun: boolean;
  /** A smaller try limit for checking a dry run by hand (default `MAX_TRIES_PER_RUN`) */
  maxTries?: number;
}

/** What the publish date falls back to when the page shows none (`attempt-record.ts`) */
function fallbackDateLabel(candidate: Candidate): string {
  if (candidate.rssPubDate) return `RSS の配信日 ${candidate.rssPubDate.toISOString()}`;
  if (candidate.registeredAt) return `登録日 ${candidate.registeredAt.toISOString()}`;
  return '初めて試した日';
}

/** One tried URL, held until its record is saved */
interface Attempted {
  previous: AttemptRecord | undefined;
  context: AttemptContext;
  attempt: AttemptResult;
  item: RunItem;
}

export async function runScheduled(deps: ScheduledRunDeps, options: RunOptions): Promise<ScheduledRunSummary> {
  const maxTries = Math.min(options.maxTries ?? MAX_TRIES_PER_RUN, MAX_TRIES_PER_RUN);
  const log = deps.log ?? (() => {});
  const startedAt = deps.now();

  const items: RunItem[] = [];
  const feedErrors: string[] = [];
  let candidateCount = 0;
  let prCount = 0;
  let stopReason: StopReason | undefined;
  let error: string | undefined;
  let pendingFailures: Attempted[] = [];

  /** Store what happened to one URL and show the next try (or the give-up) in the summary */
  const persist = async (entry: Attempted, countFailure: boolean) => {
    const record = buildAttemptRecord(entry.previous, entry.context, entry.attempt, countFailure);
    entry.item.nextAttemptAt = record.nextAttemptAt;
    entry.item.givenUpReason = record.givenUpReason;
    if (options.dryRun) return;
    if (!(await deps.store.save(record))) {
      // The URL was given up while this run was trying it (its registration was removed), and
      // the store keeps it that way: it is not tried again, whatever the summary computed
      log(`  記録を変えませんでした (この回の途中で打ち切られた URL): ${record.url}`);
      entry.item.nextAttemptAt = null;
      entry.item.givenUpReason = ALREADY_GIVEN_UP_REASON;
    }
  };

  /** Save the held failures. They count toward the retry limit unless the run hit an outage */
  const flushFailures = async (counted: boolean) => {
    const held = pendingFailures;
    pendingFailures = [];
    for (const entry of held) await persist(entry, counted);
  };

  try {
    const [registered, rss, dueRecords] = await Promise.all([
      // Registered URLs are one source among three; failing to read them should not stop the run
      deps.loadRegisteredUrls().catch((caught: unknown) => {
        feedErrors.push(`登録 URL: ${caught instanceof Error ? caught.message : String(caught)}`);
        return [];
      }),
      deps.loadRssItems(),
      deps.store.findDueRetries(startedAt, DUE_RETRY_READ_LIMIT),
    ]);
    feedErrors.push(...rss.errors);
    const attemptedUrls = await deps.store.findAttempted([
      ...registered.map(entry => entry.url),
      ...rss.items.map(item => normalizeAttemptUrl(item.link)),
    ]);
    const candidates = orderCandidates({
      registered,
      dueRetries: dueRecords,
      rssItems: rss.items,
      attemptedUrls,
      now: startedAt,
    });
    candidateCount = candidates.length;
    const count = (source: string) => candidates.filter(candidate => candidate.source === source).length;
    log(
      `候補 ${candidates.length} 件 (登録 URL ${count('registered')} 件、試し直し ${count('retry')} 件、RSS ${count('rss')} 件、読めなかったフィード ${feedErrors.length} 件)`,
    );

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
      if (now.getTime() - startedAt.getTime() >= RUN_TIME_BUDGET_MINUTES * 60_000) {
        stopReason = 'time-budget';
        break;
      }

      log(`[${items.length + 1}] ${candidate.url}`);
      const context: AttemptContext = {
        url: candidate.url,
        // A retry keeps the source of its first attempt (`buildAttemptRecord`)
        source: candidate.source === 'registered' ? 'registered' : 'rss',
        feedId: candidate.feedId,
        title: candidate.title,
        rssPubDate: candidate.rssPubDate,
        registeredAt: candidate.registeredAt,
        now,
      };

      let attempt: AttemptResult;
      try {
        const page = await deps.fetchPage(candidate.url);
        // A registered URL has no title until its page is read (an RSS title can be empty too)
        context.title ||= page.title || undefined;
        context.pageDate = extractPublishedDate(page.pageHtml, now);
        log(
          context.pageDate
            ? `  公開日: ${context.pageDate.date.toISOString()} (${context.pageDate.source})`
            : `  公開日: ページから読めず (${fallbackDateLabel(candidate)} を使う)`,
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
      } catch (caught) {
        attempt = { kind: 'error', error: caught instanceof Error ? caught.message : String(caught) };
      }

      const item: RunItem = {
        url: candidate.url,
        registered: candidate.source === 'registered' || candidate.previous?.source === 'registered',
        title: context.title,
        outcome: toAttemptOutcome(attempt, true).kind,
        ...describeAttempt(attempt),
      };
      items.push(item);
      const entry: Attempted = { previous: candidate.previous, context, attempt, item };

      if (item.outcome === 'failure') {
        pendingFailures.push(entry);
        if (pendingFailures.length >= MAX_CONSECUTIVE_FAILURES) {
          await flushFailures(false);
          stopReason = 'consecutive-failures';
          break;
        }
        continue;
      }

      await flushFailures(true);
      if (item.outcome === 'pr') prCount++;
      await persist(entry, true);
    }
    await flushFailures(true);
  } catch (caught) {
    // The run itself failed (Firestore, reading the feeds). The attempt record can no longer be
    // trusted, so stop; the summary still lists what was done. A URL whose record was not saved
    // is tried again later, and no second PR is made because the pipeline skips an event that
    // already has an article. Held failures are always saved before the next record, so they
    // are only lost when saving them is what failed (retrying here would fail the same way)
    error = caught instanceof Error ? caught.message : String(caught);
    stopReason = 'error';
  }

  return {
    dryRun: options.dryRun,
    startedAt,
    finishedAt: deps.now(),
    items,
    candidateCount,
    stopReason,
    error,
    feedErrors,
  };
}
