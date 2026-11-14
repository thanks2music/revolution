/**
 * Put the URLs a scheduled run will try in order (decided 2026-11-15).
 *
 * 1. URLs whose retry is due (details not announced yet, or a failure), the longest-waiting first
 * 2. new RSS items delivered within the last 14 days, the newest first
 *
 * URLs registered by hand will come first once they exist (the next PR adds them).
 * A URL that was tried before is never a new item, and the same page is listed once even when
 * it arrives through several feeds or with different tracking parameters (`attempt-url.ts`).
 * The run itself stops after 15 tries or 5 PRs; this module only orders.
 *
 * @module lib/scheduled/candidates
 */
import { normalizeAttemptUrl } from './attempt-url';

export const RSS_MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RssCandidateInput {
  /** The item's link as the feed gives it (a Google redirect URL is fine) */
  link: string;
  title: string;
  /** The item's delivery date as the feed gives it */
  pubDate: string;
  feedId: string;
}

export interface DueRetryInput {
  /** The normalized URL stored in the attempt record */
  url: string;
  title?: string;
  feedId?: string;
  nextAttemptAt: Date;
}

export interface Candidate {
  /** Normalized URL: what is fetched, compared and stored */
  url: string;
  source: 'retry' | 'rss';
  title?: string;
  feedId?: string;
  /** The RSS delivery date (new RSS items only) */
  rssPubDate?: Date;
}

export interface OrderCandidatesInput {
  dueRetries: DueRetryInput[];
  rssItems: RssCandidateInput[];
  /** Normalized URLs that already have an attempt record */
  attemptedUrls: ReadonlySet<string>;
  now: Date;
}

export function orderCandidates({ dueRetries, rssItems, attemptedUrls, now }: OrderCandidatesInput): Candidate[] {
  const seen = new Set<string>();
  const ordered: Candidate[] = [];

  const retries = [...dueRetries].sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
  for (const retry of retries) {
    if (seen.has(retry.url)) continue;
    seen.add(retry.url);
    ordered.push({ url: retry.url, source: 'retry', title: retry.title, feedId: retry.feedId });
  }

  const oldest = now.getTime() - RSS_MAX_AGE_DAYS * DAY_MS;
  const fresh = rssItems
    .map(item => ({ item, url: normalizeAttemptUrl(item.link), pubDate: new Date(item.pubDate) }))
    // An item without a readable date cannot be checked against the 14 days, so it is left out
    .filter(({ pubDate }) => !Number.isNaN(pubDate.getTime()))
    .filter(({ pubDate }) => pubDate.getTime() >= oldest && pubDate.getTime() <= now.getTime() + DAY_MS)
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  for (const { item, url, pubDate } of fresh) {
    if (!url || seen.has(url) || attemptedUrls.has(url)) continue;
    seen.add(url);
    ordered.push({ url, source: 'rss', title: item.title, feedId: item.feedId, rssPubDate: pubDate });
  }

  return ordered;
}
