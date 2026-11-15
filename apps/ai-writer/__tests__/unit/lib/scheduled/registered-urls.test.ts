/**
 * Layer 2: registering, listing and removing URLs, with both stores faked
 * (decisions of 2026-11-15).
 */
import { describe, expect, it } from '@jest/globals';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import { attemptDocId } from '@/lib/scheduled/attempt-url';
import { AlreadyRegisteredError, type RegisteredUrl } from '@/lib/scheduled/registered-url-store';
import {
  listRegisteredUrls,
  parseRegisteredUrl,
  registerUrl,
  UNREGISTERED_REASON,
  unregisterUrl,
  type RegisteredUrlDeps,
} from '@/lib/scheduled/registered-urls';

const NOW = new Date('2026-11-15T03:00:00Z');

const record = (url: string, overrides: Partial<AttemptRecord> = {}): AttemptRecord => ({
  url,
  source: 'registered',
  status: 'done',
  lastOutcome: 'skipped',
  lastReason: '対象外',
  attemptCount: 1,
  unannouncedCount: 0,
  failureCount: 0,
  firstAttemptAt: NOW,
  lastAttemptAt: NOW,
  nextAttemptAt: null,
  publishedAt: NOW,
  publishedAtSource: 'registration',
  ...overrides,
});

function fakeDeps(options: { registered?: RegisteredUrl[]; attempts?: AttemptRecord[] } = {}) {
  const registered = new Map((options.registered ?? []).map(entry => [entry.id, entry]));
  const attempts = new Map((options.attempts ?? []).map(entry => [entry.url, entry]));
  const deps: RegisteredUrlDeps = {
    registered: {
      list: async () => [...registered.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      get: async id => registered.get(id),
      add: async (url, createdBy, now) => {
        const id = attemptDocId(url);
        if (registered.has(id)) throw new AlreadyRegisteredError(url);
        const entry = { id, url, createdBy, createdAt: now };
        registered.set(id, entry);
        return entry;
      },
      remove: async id => {
        registered.delete(id);
      },
    },
    attempts: {
      get: async url => attempts.get(url),
      getMany: async urls => new Map(urls.filter(url => attempts.has(url)).map(url => [url, attempts.get(url)!])),
      save: async entry => {
        attempts.set(entry.url, entry);
      },
    },
  };
  return { deps, registered, attempts };
}

const entry = (url: string, createdAt = NOW): RegisteredUrl => ({
  id: attemptDocId(url),
  url,
  createdBy: 'boss@example.com',
  createdAt,
});

describe('parseRegisteredUrl', () => {
  it('normalizes the URL the same way as the attempt record', () => {
    expect(parseRegisteredUrl('  https://a.example/event?utm_source=x#top ')).toBe('https://a.example/event');
    expect(
      parseRegisteredUrl('https://www.google.com/url?rct=j&url=https://a.example/event&ct=ga'),
    ).toBe('https://a.example/event');
  });

  it('refuses anything that is not an http(s) URL', () => {
    expect(parseRegisteredUrl('not a url')).toBeUndefined();
    expect(parseRegisteredUrl('javascript:alert(1)')).toBeUndefined();
    expect(parseRegisteredUrl('ftp://a.example/file')).toBeUndefined();
  });
});

describe('registerUrl', () => {
  it('registers a new URL under its normalized form', async () => {
    const { deps, registered } = fakeDeps();
    const result = await registerUrl(deps, 'https://a.example/event?fbclid=1', 'boss@example.com', NOW);
    expect(result).toMatchObject({ kind: 'registered', registered: { url: 'https://a.example/event' } });
    expect(registered.size).toBe(1);
  });

  it('does not register a URL that was already tried, and returns its result', async () => {
    const tried = record('https://a.example/event', { source: 'rss' });
    const { deps, registered } = fakeDeps({ attempts: [tried] });
    const result = await registerUrl(deps, 'https://a.example/event?utm_medium=x', 'boss@example.com', NOW);
    expect(result).toEqual({ kind: 'already-attempted', attempt: tried });
    expect(registered.size).toBe(0);
  });

  it('reports a URL that is already registered', async () => {
    const { deps } = fakeDeps({ registered: [entry('https://a.example/event')] });
    expect(await registerUrl(deps, 'https://a.example/event', 'boss@example.com', NOW)).toEqual({
      kind: 'already-registered',
    });
  });

  it('refuses an invalid URL', async () => {
    const { deps } = fakeDeps();
    expect(await registerUrl(deps, 'event page', 'boss@example.com', NOW)).toMatchObject({ kind: 'invalid' });
  });
});

describe('listRegisteredUrls', () => {
  it('joins each registration with its attempt record, if any', async () => {
    const tried = record('https://a.example/tried');
    const { deps } = fakeDeps({
      registered: [entry('https://a.example/new', new Date('2026-11-14T00:00:00Z')), entry('https://a.example/tried', new Date('2026-11-10T00:00:00Z'))],
      attempts: [tried],
    });
    const list = await listRegisteredUrls(deps);
    expect(list.map(item => [item.url, item.attempt?.status])).toEqual([
      ['https://a.example/tried', 'done'],
      ['https://a.example/new', undefined],
    ]);
  });
});

describe('unregisterUrl', () => {
  it('removes a registration that was never tried', async () => {
    const { deps, registered, attempts } = fakeDeps({ registered: [entry('https://a.example/1')] });
    expect(await unregisterUrl(deps, attemptDocId('https://a.example/1'))).toBe(true);
    expect(registered.size).toBe(0);
    expect(attempts.size).toBe(0);
  });

  it.each(['waiting-details', 'retrying-failure'] as const)('gives up a URL in %s and keeps its record', async status => {
    const waiting = record('https://a.example/1', { status, nextAttemptAt: new Date('2026-11-20T00:00:00Z') });
    const { deps, registered, attempts } = fakeDeps({ registered: [entry('https://a.example/1')], attempts: [waiting] });
    await unregisterUrl(deps, attemptDocId('https://a.example/1'));
    expect(registered.size).toBe(0);
    expect(attempts.get('https://a.example/1')).toMatchObject({
      status: 'given-up',
      nextAttemptAt: null,
      givenUpReason: UNREGISTERED_REASON,
      attemptCount: 1,
    });
  });

  it('leaves a finished record as it is', async () => {
    const done = record('https://a.example/1', { status: 'done', lastOutcome: 'pr', prUrl: 'https://github.com/o/r/pull/1' });
    const { deps, attempts } = fakeDeps({ registered: [entry('https://a.example/1')], attempts: [done] });
    await unregisterUrl(deps, attemptDocId('https://a.example/1'));
    expect(attempts.get('https://a.example/1')).toBe(done);
  });

  it('returns false for an unknown registration', async () => {
    const { deps } = fakeDeps();
    expect(await unregisterUrl(deps, 'missing')).toBe(false);
  });

  it('a removed URL is not tried again when registered later', async () => {
    const done = record('https://a.example/1');
    const { deps } = fakeDeps({ registered: [entry('https://a.example/1')], attempts: [done] });
    await unregisterUrl(deps, attemptDocId('https://a.example/1'));
    expect(await registerUrl(deps, 'https://a.example/1', 'boss@example.com', NOW)).toMatchObject({
      kind: 'already-attempted',
    });
  });
});
