/**
 * Entry point of the scheduled job (Cloud Run Jobs, started by Cloud Scheduler).
 *
 * One run reads the URLs registered from the admin UI, the active RSS feeds and the URLs whose
 * retry is due, sends them through the article pipeline one by one (`lib/scheduled/run.ts` has
 * the limits), stores what happened to each URL, and posts one Slack message for the run.
 *
 * Usage:
 *   tsx scripts/run-scheduled.ts --dry-run   # no PR, no Firestore write (reads Firestore)
 *   tsx scripts/run-scheduled.ts --dry-run --max-tries 3   # try fewer candidates (dry run only)
 *   tsx scripts/run-scheduled.ts             # the real run. Refused outside Cloud Run
 *
 * The real run makes article PRs and writes Firestore, so it only runs on Cloud Run.
 * A real run from a laptop would be easy to start by mistake and would compete with the job.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Local runs read .env.local (no override, so inline env wins). On Cloud Run the file is absent
config({ path: resolve(__dirname, '../.env.local') });

import { getAdminDb } from '../lib/firebase/admin';
import { flushSentry, Sentry, serverSentryOptions } from '../lib/observability/sentry';
import { ArticleGenerationMdxService } from '../lib/services/article-generation-mdx.service';
import { RssArticleCollectionService } from '../lib/services/rss-article-collection.service';
import { AttemptStore } from '../lib/scheduled/attempt-store';
import type { RssCandidateInput } from '../lib/scheduled/candidates';
import { attemptDocId } from '../lib/scheduled/attempt-url';
import { DetectedLinkStore } from '../lib/scheduled/detected-link-store';
import { RegisteredUrlStore } from '../lib/scheduled/registered-url-store';
import { runScheduled } from '../lib/scheduled/run';
import { prCountOf, type ScheduledRunSummary, type StopReason } from '../lib/scheduled/summary';
import { notifyScheduledRun } from '../lib/slack';
import { redactSecrets, truncate } from '../lib/slack/messages';
import { rssFeedFromDoc } from '../lib/firestore/rss-feed-doc';
import { extractArticleData } from '../lib/utils/html-extractor';
import { isCloudRun } from '../lib/utils/cloud-run';

/** Google Alerts wraps the matched words in <b>; Slack and the record want plain text */
function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function loadRssItems(): Promise<{ items: RssCandidateInput[]; errors: string[] }> {
  const snapshot = await getAdminDb().collection('rss_feeds').where('isActive', '==', true).get();
  const feeds = snapshot.docs.map(doc => rssFeedFromDoc(doc.id, doc.data()));

  // No per-feed count limit (0 turns the slice off): the 14-day window and the per-run limits
  // decide how much is tried
  const collector = new RssArticleCollectionService({ maxArticlesPerFeed: 0 });
  const items: RssCandidateInput[] = [];
  const errors: string[] = [];
  for (const feed of feeds) {
    try {
      const articles = await collector.collectArticlesFromFeedObject(feed);
      for (const article of articles) {
        if (!article.link) continue;
        // An item without a date is left out by the 14-day check (`orderCandidates`)
        items.push({ link: article.link, title: plainText(article.title), pubDate: article.pubDate ?? '', feedId: feed.id });
      }
    } catch (error) {
      errors.push(`${feed.title || feed.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { items, errors };
}

function logSummary(summary: ScheduledRunSummary): void {
  console.log('\n' + '='.repeat(80));
  console.log(`定期実行の結果${summary.dryRun ? ' (dry-run)' : ''}: ${summary.dryRun ? '記事にできる' : 'PR'} ${prCountOf(summary)} 本 / 試した ${summary.items.length} 件 / 候補 ${summary.candidateCount} 件`);
  if (summary.stopReason) console.log(`止めた理由: ${summary.stopReason}${summary.error ? ` (${summary.error})` : ''}`);
  for (const error of summary.feedErrors) console.log(`読めなかったフィード: ${error}`);
  for (const item of summary.items) {
    console.log(`- ${item.outcome}: ${item.url}${item.reason ? ` (${item.reason})` : ''}${item.prUrl ? ` ${item.prUrl}` : ''}`);
    if (item.givenUpReason) console.log(`  打ち切り: ${item.givenUpReason}`);
  }
  console.log('='.repeat(80));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dryRun = false;
  let maxTries: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--max-tries' && /^[1-9]\d*$/.test(args[i + 1] ?? '')) {
      maxTries = Number(args[++i]);
    } else {
      console.error(`Unknown argument: ${args[i]}. Accepted: --dry-run, --max-tries <n> (with --dry-run only).`);
      process.exitCode = 2;
      return;
    }
  }
  // The try limit is fixed for real runs; a smaller one is only for checking a dry run by hand
  if (maxTries !== undefined && !dryRun) {
    console.error('--max-tries is only accepted with --dry-run.');
    process.exitCode = 2;
    return;
  }
  if (!dryRun && !isCloudRun()) {
    console.error('The real run only runs on Cloud Run. Use --dry-run to try it locally.');
    process.exitCode = 2;
    return;
  }

  // Next.js initializes Sentry through instrumentation.ts; a tsx script has to do it itself.
  // Same options as the Next.js server. Without SENTRY_DSN (local runs) nothing is sent
  Sentry.init({ ...serverSentryOptions(), initialScope: { tags: { entrypoint: 'job' } } });

  console.log(`🗓️ 定期実行を開始します${dryRun ? ' (dry-run: PR と Firestore への書き込みなし)' : ''}`);
  const startedAt = new Date();
  let summary: ScheduledRunSummary;
  try {
    const service = new ArticleGenerationMdxService();
    summary = await runScheduled(
      {
        now: () => new Date(),
        store: new AttemptStore(getAdminDb()),
        loadRegisteredUrls: () => new RegisteredUrlStore(getAdminDb()).list(),
        isRegistered: async url => (await new RegisteredUrlStore(getAdminDb()).get(attemptDocId(url))) !== undefined,
        loadDetectedLinks: () => new DetectedLinkStore(getAdminDb()).listRecent(new Date(), console.log),
        loadRssItems,
        fetchPage: extractArticleData,
        generate: request => service.generateMdxFromRSS(request),
        log: message => console.log(`[Scheduled] ${message}`),
      },
      { dryRun, maxTries },
    );
  } catch (error) {
    // runScheduled catches the errors of the run; this is a bug or a broken setup (Firebase Admin)
    console.error('❌ 定期実行が始められませんでした:', error);
    Sentry.captureException(error);
    summary = {
      dryRun,
      startedAt,
      finishedAt: new Date(),
      items: [],
      candidateCount: 0,
      stopReason: 'error',
      error: error instanceof Error ? error.message : String(error),
      feedErrors: [],
    };
  }

  logSummary(summary);
  const alert = summary.stopReason ? ALERTS[summary.stopReason] : undefined;
  if (alert) {
    Sentry.captureMessage(alert.message, {
      level: 'error',
      fingerprint: [alert.fingerprint],
      // Provider errors can echo request details; mask secrets the same way as the Slack message
      extra: { errors: alert.errors(summary).map(text => truncate(redactSecrets(text), 500)) },
    });
    process.exitCode = 1;
  }
  await notifyScheduledRun(summary);
  await flushSentry(2000);
}

/** Stop reasons that need a person: reported to Sentry and ending with exit code 1 */
const ALERTS: Partial<
  Record<StopReason, { message: string; fingerprint: string; errors: (summary: ScheduledRunSummary) => string[] }>
> = {
  'consecutive-failures': {
    message: 'Scheduled run stopped after consecutive failures',
    fingerprint: 'scheduled-run-consecutive-failures',
    errors: summary => summary.items.slice(-3).map(item => item.reason ?? ''),
  },
  error: {
    message: 'Scheduled run stopped on an error of the run itself',
    fingerprint: 'scheduled-run-error',
    errors: summary => [summary.error ?? ''],
  },
};

main();
