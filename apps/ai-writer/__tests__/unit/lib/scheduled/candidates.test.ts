/**
 * Layer 1: the order a scheduled run tries URLs in (decided 2026-11-15).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import {
  isChosenByPerson,
  isRssCandidate,
  newAttemptSource,
  orderCandidates,
  originSource,
  type RssCandidateInput,
} from '@/lib/scheduled/candidates';
import type { DetectedLink } from '@revolution/schemas/detected-link';

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
      detected: [],
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
      detected: [],
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
      detected: [],
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
      detected: [],
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
      detected: [],
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
      detected: [],
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
});

const detected = (url: string, ageDays: number): DetectedLink => ({
  url,
  targetId: 'target-1',
  targetTitle: 'サンプル公式サイト',
  detectedAt: NOW.getTime() - ageDays * 24 * 60 * 60 * 1000,
});

describe('detected links', () => {
  it('come after registered URLs and before retries and RSS, the oldest detection first', () => {
    const result = orderCandidates({
      registered: [{ id: 'r', url: 'https://reg.example/r', createdBy: 'boss@example.com', createdAt: NOW }],
      detected: [detected('https://det.example/new', 1), detected('https://det.example/old', 5)],
      dueRetries: [due('https://retry.example/1', new Date('2026-11-14T00:00:00Z'))],
      rssItems: [rss('https://rss.example/1', 1)],
      attemptedUrls: new Set(),
      now: NOW,
    });
    expect(result.map(c => [c.source, c.url])).toEqual([
      ['registered', 'https://reg.example/r'],
      ['detected', 'https://det.example/old'],
      ['detected', 'https://det.example/new'],
      ['retry', 'https://retry.example/1'],
      ['rss', 'https://rss.example/1'],
    ]);
    expect(result[1].detectedAt?.getTime()).toBe(detected('x', 5).detectedAt);
  });

  it('leave out links already tried and a page already listed', () => {
    const result = orderCandidates({
      registered: [{ id: 'r', url: 'https://same.example/', createdBy: 'boss@example.com', createdAt: NOW }],
      detected: [
        detected('https://det.example/tried', 1),
        detected('https://same.example/', 1),
        detected('https://det.example/edge', 30),
      ],
      dueRetries: [],
      rssItems: [],
      attemptedUrls: new Set(['https://det.example/tried']),
      now: NOW,
    });
    expect(result.map(c => [c.source, c.url])).toEqual([
      ['registered', 'https://same.example/'],
      ['detected', 'https://det.example/edge'],
    ]);
  });

  it('start their attempt record as detected (a retry keeps its first source)', () => {
    expect(newAttemptSource({ source: 'detected' })).toBe('detected');
    expect(newAttemptSource({ source: 'registered' })).toBe('registered');
    expect(newAttemptSource({ source: 'rss' })).toBe('rss');
  });

  it('are chosen by a person (writing scope not applied), like registered URLs', () => {
    expect(isChosenByPerson({ source: 'detected' })).toBe(true);
    expect(isChosenByPerson({ source: 'retry', previous: { ...due('https://a.example/1', NOW), source: 'detected' } })).toBe(true);
    expect(isChosenByPerson({ source: 'rss' })).toBe(false);
    expect(isRssCandidate({ source: 'detected' })).toBe(false);
  });
});

describe('isRssCandidate', () => {
  it('is an RSS item, or a retry whose first attempt was one', () => {
    expect(isRssCandidate({ source: 'rss' })).toBe(true);
    expect(isRssCandidate({ source: 'retry', previous: due('https://a.example/1', NOW) })).toBe(true);
  });

  it('is not a registered URL or a retry of one or of a CLI run', () => {
    expect(isRssCandidate({ source: 'registered' })).toBe(false);
    expect(isRssCandidate({ source: 'retry', previous: { ...due('https://a.example/1', NOW), source: 'registered' } })).toBe(false);
    expect(isRssCandidate({ source: 'retry', previous: { ...due('https://a.example/1', NOW), source: 'cli' } })).toBe(false);
  });
});

describe('originSource', () => {
  it('is the source of a new candidate, and the first attempt\'s source for a retry', () => {
    expect(originSource({ source: 'registered' })).toBe('registered');
    expect(originSource({ source: 'retry', previous: { ...due('https://a.example/1', NOW), source: 'cli' } })).toBe('cli');
  });
});
