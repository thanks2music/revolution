/**
 * Layer 2: the registered URL API routes (auth, input checks and the response shapes).
 *
 * The stores are replaced with in-memory fakes. The routes are required after the mocks are
 * registered, because next/jest (SWC) does not hoist `jest.mock` above the imports.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import { attemptDocId } from '@/lib/scheduled/attempt-url';
import type { RegisteredUrl } from '@/lib/scheduled/registered-url-store';
import type { RegisteredUrlDeps } from '@/lib/scheduled/registered-urls';

const requireAuth = jest.fn(async () => ({ uid: 'u1', email: 'boss@example.com', emailVerified: true }));
jest.mock('@/lib/auth/server-auth', () => ({ requireAuth: () => requireAuth() }));

let registered = new Map<string, RegisteredUrl>();
let attempts = new Map<string, AttemptRecord>();
const deps: RegisteredUrlDeps = {
  registered: {
    list: async () => [...registered.values()],
    get: async id => registered.get(id),
    add: async (url, createdBy, now) => {
      const id = attemptDocId(url);
      if (registered.has(id)) return undefined;
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
    giveUpIfAwaitingRetry: async () => false,
  },
  assertPublicHost: async url => {
    if (url.hostname === 'internal.example') throw new Error('Blocked');
  },
};
jest.mock('@/lib/scheduled/registered-url-api', () => ({
  ...(jest.requireActual('@/lib/scheduled/registered-url-api') as object),
  registeredUrlDeps: () => deps,
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { GET, POST } = require('@/app/api/registered-urls/route') as typeof import('@/app/api/registered-urls/route');
const { DELETE } = require('@/app/api/registered-urls/[id]/route') as typeof import('@/app/api/registered-urls/[id]/route');
/* eslint-enable @typescript-eslint/no-require-imports */

const post = (body: string) =>
  POST(new NextRequest('http://localhost/api/registered-urls', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
const remove = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/registered-urls/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  registered = new Map();
  attempts = new Map();
  requireAuth.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('registered URL API', () => {
  it('answers 401 without a signed-in user, on every route', async () => {
    requireAuth.mockImplementation(async () => {
      throw new Error('Unauthorized');
    });
    expect((await GET()).status).toBe(401);
    expect((await post('{"url":"https://a.example/1"}')).status).toBe(401);
    expect((await remove(attemptDocId('https://a.example/1'))).status).toBe(401);
    requireAuth.mockImplementation(async () => ({ uid: 'u1', email: 'boss@example.com', emailVerified: true }));
  });

  it.each(['null', '[]', '"https://a.example/1"', '{}', 'not json'])('answers 400 for the body %s', async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('answers 400 for a URL that is not http(s) or points at an internal host', async () => {
    expect((await post('{"url":"ftp://a.example/1"}')).status).toBe(400);
    expect((await post('{"url":"https://internal.example/1"}')).status).toBe(400);
  });

  it('registers a URL (201) and lists it with no result yet', async () => {
    const response = await post('{"url":"https://a.example/1?utm_source=x"}');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      url: { url: 'https://a.example/1', createdBy: 'boss@example.com' },
    });

    const list = await (await GET()).json();
    expect(list).toMatchObject({ success: true, urls: [{ url: 'https://a.example/1' }] });
    expect(list.urls[0].attempt).toBeUndefined();
  });

  it('answers 409 with the earlier result for a URL that was already tried, and for a duplicate', async () => {
    attempts.set('https://a.example/tried', {
      url: 'https://a.example/tried',
      source: 'rss',
      status: 'done',
      lastOutcome: 'skipped',
      lastReason: '既に記事があります',
      attemptCount: 1,
      unannouncedCount: 0,
      failureCount: 0,
      firstAttemptAt: new Date('2026-11-14T01:05:00Z'),
      lastAttemptAt: new Date('2026-11-14T01:05:00Z'),
      nextAttemptAt: null,
      publishedAt: new Date('2026-11-13T00:00:00Z'),
      publishedAtSource: 'rss',
    });
    const tried = await post('{"url":"https://a.example/tried"}');
    expect(tried.status).toBe(409);
    expect(await tried.json()).toMatchObject({
      reason: 'already-attempted',
      attempt: { status: 'done', lastReason: '既に記事があります', lastAttemptAt: '2026-11-14T01:05:00.000Z' },
    });

    await post('{"url":"https://a.example/1"}');
    const duplicate = await post('{"url":"https://a.example/1"}');
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ reason: 'already-registered' });
  });

  it('removes a registration, and answers 404 for an unknown or malformed ID', async () => {
    await post('{"url":"https://a.example/1"}');
    const id = attemptDocId('https://a.example/1');
    expect((await remove(id)).status).toBe(200);
    expect(registered.size).toBe(0);
    expect((await remove(id)).status).toBe(404);
    expect((await remove('a/b')).status).toBe(404);
  });
});
