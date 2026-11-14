/**
 * Entry point of the scheduled job (Cloud Run Jobs, started by Cloud Scheduler).
 *
 * One run reads the active RSS feeds and the URLs whose retry is due, sends them through the
 * article pipeline one by one (`lib/scheduled/run.ts` has the limits), stores what happened to
 * each URL, and posts one Slack message for the run.
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
import { beforeSendFilter, flushSentry, Sentry } from '../lib/observability/sentry';
import { ArticleGenerationMdxService } from '../lib/services/article-generation-mdx.service';
import { RssArticleCollectionService } from '../lib/services/rss-article-collection.service';
import { AttemptStore } from '../lib/scheduled/attempt-store';
import type { RssCandidateInput } from '../lib/scheduled/candidates';
import { runScheduled, type ScheduledRunSummary } from '../lib/scheduled/run';
import { notifyPipelineResult, notifyScheduledRun } from '../lib/slack';
import type { RssFeed } from '../lib/types/rss-feed';
import { extractArticleData } from '../lib/utils/html-extractor';
import { isCloudRun } from '../lib/utils/cloud-run';

/** Google Alerts wraps the matched words in <b>; Slack and the record want plain text */
function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function loadRssItems(): Promise<{ items: RssCandidateInput[]; errors: string[] }> {
  const snapshot = await getAdminDb().collection('rss_feeds').where('isActive', '==', true).get();
  const feeds: RssFeed[] = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      url: data.url,
      title: data.title,
      isActive: data.isActive,
      validationConfig: data.validationConfig || undefined,
      createdAt: data.createdAt?.toDate?.() ?? new Date(0),
      updatedAt: data.updatedAt?.toDate?.() ?? new Date(0),
      createdBy: data.createdBy,
    };
  });

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
        items.push({ link: article.link, title: plainText(article.title), pubDate: article.pubDate, feedId: feed.id });
      }
    } catch (error) {
      errors.push(`${feed.title || feed.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { items, errors };
}

function logSummary(summary: ScheduledRunSummary): void {
  console.log('\n' + '='.repeat(80));
  console.log(`定期実行の結果${summary.dryRun ? ' (dry-run)' : ''}: ${summary.dryRun ? '記事にできる' : 'PR'} ${summary.prCount} 本 / 試した ${summary.items.length} 件 / 候補 ${summary.candidateCount} 件`);
  if (summary.stopReason) console.log(`止めた理由: ${summary.stopReason}`);
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
  // Without SENTRY_DSN (local runs) nothing is sent
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      beforeSend: beforeSendFilter,
      sendDefaultPii: false,
      initialScope: { tags: { entrypoint: 'job' } },
    });
  }

  console.log(`🗓️ 定期実行を開始します${dryRun ? ' (dry-run: PR と Firestore への書き込みなし)' : ''}`);
  try {
    const service = new ArticleGenerationMdxService();
    const summary = await runScheduled(
      {
        now: () => new Date(),
        store: new AttemptStore(getAdminDb()),
        loadRssItems,
        fetchPage: extractArticleData,
        generate: request => service.generateMdxFromRSS(request),
        log: message => console.log(`[Scheduled] ${message}`),
      },
      { dryRun, maxTries },
    );
    logSummary(summary);
    if (summary.stopReason === 'consecutive-failures') {
      Sentry.captureMessage('Scheduled run stopped after consecutive failures', {
        level: 'error',
        fingerprint: ['scheduled-run-consecutive-failures'],
        extra: { errors: summary.items.slice(-3).map(item => item.reason) },
      });
      process.exitCode = 1;
    }
    await notifyScheduledRun(summary);
  } catch (error) {
    // The run itself broke (Firestore, the feeds' collection ...): nothing of the run is reliable
    console.error('❌ 定期実行が途中で止まりました:', error);
    Sentry.captureException(error, { tags: { entrypoint: 'job' } });
    await notifyPipelineResult({
      outcome: 'failure',
      entrypoint: 'job',
      sourceUrl: '定期実行',
      mode: dryRun ? 'dry-run' : 'pr',
      error: error instanceof Error ? error.message : String(error),
      revision: process.env.CLOUD_RUN_EXECUTION,
    });
    process.exitCode = 1;
  } finally {
    await flushSentry(2000);
  }
}

main();
