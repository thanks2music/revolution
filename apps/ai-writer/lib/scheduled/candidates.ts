/**
 * Put the URLs a scheduled run will try in order (decided 2026-11-15).
 *
 * 1. URLs registered by hand that have not been tried yet, the oldest registration first
 * 2. links the WEB checker detected that have not been tried yet (the store reads only those
 *    detected within the last 30 days), the oldest detection first (decided 2026-11-23). A person chose the watched page
 *    and to hand its links over, so they come before retries and RSS
 * 3. URLs whose retry is due (details not announced yet, or a failure), the longest-waiting first.
 *    A registered URL or detected link that is waiting for a retry comes back here, not in 1 or 2
 * 4. new RSS items delivered within the last 14 days, the newest first
 *
 * A URL that was tried before is never a new item, and the same page is listed once even when
 * it arrives through several feeds or with different tracking parameters (`attempt-url.ts`).
 * The run itself stops after 15 tries or 5 PRs; this module only orders.
 *
 * @module lib/scheduled/candidates
 */
import { DAY_MS } from '@/lib/utils/date';
import type { DetectedLink } from '@revolution/schemas/detected-link';

import type { AttemptRecord, AttemptSource } from './attempt-store';
import { normalizeAttemptUrl } from './attempt-url';
import type { RegisteredUrl } from './registered-url-store';

const RSS_MAX_AGE_DAYS = 14;

export interface RssCandidateInput {
  /** The item's link as the feed gives it (a Google redirect URL is fine) */
  link: string;
  title: string;
  /** The item's delivery date as the feed gives it */
  pubDate: string;
  feedId: string;
}

export interface Candidate {
  /** Normalized URL: what is fetched, compared and stored */
  url: string;
  source: 'registered' | 'detected' | 'retry' | 'rss';
  title?: string;
  feedId?: string;
  /** The RSS delivery date (new RSS items only) */
  rssPubDate?: Date;
  /** When the URL was registered (new registered URLs only) */
  registeredAt?: Date;
  /** When the WEB checker detected the link (new detected links only) */
  detectedAt?: Date;
  /** The stored record (retries only; a new item has none) */
  previous?: AttemptRecord;
}

/** Where a candidate first came from (a retry keeps the source of its first attempt) */
export function originSource(candidate: Pick<Candidate, 'source' | 'previous'>): AttemptSource | undefined {
  return candidate.source === 'retry' ? candidate.previous?.source : candidate.source;
}

/** The source a new candidate's attempt record starts with (a retry keeps its first source) */
export function newAttemptSource(candidate: Pick<Candidate, 'source'>): AttemptSource {
  return candidate.source === 'retry' || candidate.source === 'rss' ? 'rss' : candidate.source;
}

/** A candidate a person chose to try: a registered URL or a detected link (its first try or a retry) */
export function isChosenByPerson(candidate: Pick<Candidate, 'source' | 'previous'>): boolean {
  const origin = originSource(candidate);
  return origin === 'registered' || origin === 'detected';
}

/**
 * A candidate that came from an RSS feed: a new RSS item, or a retry whose first attempt was one.
 * Only these are limited to the writing scope (a registered URL or a CLI run was chosen by a person)
 */
export function isRssCandidate(candidate: Pick<Candidate, 'source' | 'previous'>): boolean {
  return originSource(candidate) === 'rss';
}

interface OrderCandidatesInput {
  /** URLs registered by hand (`RegisteredUrlStore.list`); tried ones are left out here */
  registered: RegisteredUrl[];
  /** Links detected within the last 30 days (`DetectedLinkStore.listRecent`); tried ones are left out here */
  detected: DetectedLink[];
  /** Records whose retry is due (`AttemptStore.findDueRetries`) */
  dueRetries: AttemptRecord[];
  rssItems: RssCandidateInput[];
  /** Normalized URLs that already have an attempt record (registered and RSS URLs) */
  attemptedUrls: ReadonlySet<string>;
  now: Date;
}

export function orderCandidates({
  registered,
  detected,
  dueRetries,
  rssItems,
  attemptedUrls,
  now,
}: OrderCandidatesInput): Candidate[] {
  const seen = new Set<string>();
  const ordered: Candidate[] = [];

  const untried = [...registered].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const entry of untried) {
    if (!entry.url || seen.has(entry.url) || attemptedUrls.has(entry.url)) continue;
    seen.add(entry.url);
    ordered.push({ url: entry.url, source: 'registered', registeredAt: entry.createdAt });
  }

  for (const link of [...detected].sort((a, b) => a.detectedAt - b.detectedAt)) {
    if (seen.has(link.url) || attemptedUrls.has(link.url)) continue;
    seen.add(link.url);
    ordered.push({ url: link.url, source: 'detected', detectedAt: new Date(link.detectedAt) });
  }

  const retries = dueRetries
    .filter((record): record is AttemptRecord & { nextAttemptAt: Date } => record.nextAttemptAt !== null)
    .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
  for (const retry of retries) {
    if (seen.has(retry.url)) continue;
    seen.add(retry.url);
    ordered.push({ url: retry.url, source: 'retry', title: retry.title, feedId: retry.feedId, previous: retry });
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
