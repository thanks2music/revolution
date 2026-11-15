/**
 * Layer 1: the order a scheduled run tries URLs in (decided 2026-11-15).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import { orderCandidates, type RssCandidateInput } from '@/lib/scheduled/candidates';

const NOW = new Date('2026-11-15T03:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toUTCString();
const rss = (link: string, ageDays: number, title = link): RssCandidateInput => ({
  link,
  title,
  pubDate: daysAgo(ageDays),
  feedId: 'feed-1',
});

const due = (url: string, nextAttemptAt: Date): AttemptRecord => ({
  url,
  source: 'rss',
  status: 'waiting-details',
  lastOutcome: 'unannounced',
  attemptCount: 1,
  unannouncedCount: 1,
  failureCount: 0,
  firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
  lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
  nextAttemptAt,
  publishedAt: new Date('2026-10-31T00:00:00Z'),
  publishedAtSource: 'rss',
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('orderCandidates', () => {
  it('puts due retries first (longest-waiting first), then new RSS items newest first', () => {
    const result = orderCandidates({
      registered: [],
      dueRetries: [
        due('https://r.example/2', new Date('2026-11-14T00:00:00Z')),
        due('https://r.example/1', new Date('2026-11-10T00:00:00Z')),
      ],
      rssItems: [rss('https://a.example/old', 5), rss('https://a.example/new', 1)],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result[0].previous?.url).toBe('https://r.example/1');
    expect(result.map(c => [c.source, c.url])).toEqual([
      ['retry', 'https://r.example/1'],
      ['retry', 'https://r.example/2'],
      ['rss', 'https://a.example/new'],
      ['rss', 'https://a.example/old'],
    ]);
  });

  it('leaves out RSS items older than 14 days and items without a readable date', () => {
    const result = orderCandidates({
      registered: [],
      dueRetries: [],
      rssItems: [rss('https://a.example/14', 14), rss('https://a.example/15', 15), { ...rss('https://a.example/x', 1), pubDate: 'unknown' }],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => c.url)).toEqual(['https://a.example/14']);
  });

  it('never lists a URL that was already tried as a new item', () => {
    const result = orderCandidates({
      registered: [],
      dueRetries: [],
      rssItems: [rss('https://a.example/1?utm_source=alert', 1), rss('https://a.example/2', 1)],
      attemptedUrls: new Set(['https://a.example/1']),
      now: NOW,
    });
    expect(result.map(c => c.url)).toEqual(['https://a.example/2']);
  });

  it('lists the same page once across feeds, Google redirects and tracking parameters', () => {
    const google = 'https://www.google.com/url?rct=j&url=https://a.example/1&ct=ga';
    const result = orderCandidates({
      registered: [],
      dueRetries: [due('https://a.example/9', NOW)],
      rssItems: [rss(google, 1), rss('https://a.example/1#top', 2), rss('https://a.example/9', 1)],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => c.url)).toEqual(['https://a.example/9', 'https://a.example/1']);
  });

  it('keeps the RSS title, feed and delivery date for new items', () => {
    const [candidate] = orderCandidates({
      registered: [],
      dueRetries: [],
      rssItems: [rss('https://a.example/1', 2, 'コラボカフェ')],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(candidate).toMatchObject({ title: 'コラボカフェ', feedId: 'feed-1', source: 'rss' });
    expect(candidate.rssPubDate?.toUTCString()).toBe(daysAgo(2));
  });

  it('puts untried registered URLs first (oldest registration first), before retries and RSS', () => {
    const result = orderCandidates({
      registered: [
        { id: 'b', url: 'https://reg.example/b', createdBy: 'boss@example.com', createdAt: new Date('2026-11-14T00:00:00Z') },
        { id: 'a', url: 'https://reg.example/a', createdBy: 'boss@example.com', createdAt: new Date('2026-11-12T00:00:00Z') },
        { id: 't', url: 'https://reg.example/tried', createdBy: 'boss@example.com', createdAt: new Date('2026-11-01T00:00:00Z') },
      ],
      dueRetries: [due('https://retry.example/1', new Date('2026-11-14T00:00:00Z'))],
      rssItems: [rss('https://rss.example/1', 1), rss('https://reg.example/a', 1)],
      attemptedUrls: new Set(['https://reg.example/tried']),
      now: NOW,
    });
    expect(result.map(c => [c.source, c.url])).toEqual([
      ['registered', 'https://reg.example/a'],
      ['registered', 'https://reg.example/b'],
      ['retry', 'https://retry.example/1'],
      ['rss', 'https://rss.example/1'],
    ]);
    expect(result[0].registeredAt).toEqual(new Date('2026-11-12T00:00:00Z'));
  });

  it('retries a registered URL only while its registration exists and is known', () => {
    const kept = { ...due('https://reg.example/kept', new Date('2026-11-14T00:00:00Z')), source: 'registered' as const };
    const removed = { ...due('https://reg.example/removed', new Date('2026-11-13T00:00:00Z')), source: 'registered' as const };
    const rssRetry = due('https://rss.example/retry', new Date('2026-11-12T00:00:00Z'));
    const registered = [
      { id: 'k', url: 'https://reg.example/kept', createdBy: 'boss@example.com', createdAt: new Date('2026-11-01T00:00:00Z') },
    ];
    const input = { registered, dueRetries: [kept, removed, rssRetry], rssItems: [], attemptedUrls: new Set(['https://reg.example/kept']), now: NOW };
    expect(orderCandidates(input).map(c => c.url)).toEqual(['https://rss.example/retry', 'https://reg.example/kept']);
    expect(orderCandidates({ ...input, registered: [], registrationsKnown: false }).map(c => c.url)).toEqual([
      'https://rss.example/retry',
    ]);
  });
});
