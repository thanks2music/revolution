/**
 * Layer 1: the order a scheduled run tries URLs in (decided 2026-11-15).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { orderCandidates, type RssCandidateInput } from '@/lib/scheduled/candidates';

const NOW = new Date('2026-11-15T03:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toUTCString();
const rss = (link: string, ageDays: number, title = link): RssCandidateInput => ({
  link,
  title,
  pubDate: daysAgo(ageDays),
  feedId: 'feed-1',
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('orderCandidates', () => {
  it('puts due retries first (longest-waiting first), then new RSS items newest first', () => {
    const result = orderCandidates({
      dueRetries: [
        { url: 'https://r.example/2', nextAttemptAt: new Date('2026-11-14T00:00:00Z') },
        { url: 'https://r.example/1', nextAttemptAt: new Date('2026-11-10T00:00:00Z') },
      ],
      rssItems: [rss('https://a.example/old', 5), rss('https://a.example/new', 1)],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => [c.source, c.url])).toEqual([
      ['retry', 'https://r.example/1'],
      ['retry', 'https://r.example/2'],
      ['rss', 'https://a.example/new'],
      ['rss', 'https://a.example/old'],
    ]);
  });

  it('leaves out RSS items older than 14 days and items without a readable date', () => {
    const result = orderCandidates({
      dueRetries: [],
      rssItems: [rss('https://a.example/14', 14), rss('https://a.example/15', 15), { ...rss('https://a.example/x', 1), pubDate: 'unknown' }],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => c.url)).toEqual(['https://a.example/14']);
  });

  it('never lists a URL that was already tried as a new item', () => {
    const result = orderCandidates({
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
      dueRetries: [{ url: 'https://a.example/9', nextAttemptAt: NOW }],
      rssItems: [rss(google, 1), rss('https://a.example/1#top', 2), rss('https://a.example/9', 1)],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => c.url)).toEqual(['https://a.example/9', 'https://a.example/1']);
  });

  it('keeps the RSS title, feed and delivery date for new items', () => {
    const [candidate] = orderCandidates({
      dueRetries: [],
      rssItems: [rss('https://a.example/1', 2, 'コラボカフェ')],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(candidate).toMatchObject({ title: 'コラボカフェ', feedId: 'feed-1', source: 'rss' });
    expect(candidate.rssPubDate?.toUTCString()).toBe(daysAgo(2));
  });
});
