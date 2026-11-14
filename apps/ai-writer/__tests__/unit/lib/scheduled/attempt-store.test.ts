/**
 * Layer 2: the Firestore side of the attempt record, against a small in-memory Firestore.
 */
import { describe, expect, it } from '@jest/globals';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { ATTEMPTS_COLLECTION, AttemptStore, type AttemptRecord } from '@/lib/scheduled/attempt-store';
import { attemptDocId } from '@/lib/scheduled/url-key';

type Doc = Record<string, unknown>;

function fakeFirestore() {
  const docs = new Map<string, Doc>();
  const docRef = (id: string) => ({
    id,
    get: async () => snapshot(id),
    set: async (data: Doc) => {
      docs.set(id, data);
    },
  });
  const snapshot = (id: string) => ({ id, exists: docs.has(id), data: () => docs.get(id) });
  const queries: unknown[][] = [];
  const db = {
    collection: (name: string) => {
      expect(name).toBe(ATTEMPTS_COLLECTION);
      return {
        doc: docRef,
        where: (field: string, op: string, value: Timestamp) => {
          queries.push([field, op, value]);
          return {
            orderBy: () => ({
              limit: (n: number) => ({
                get: async () => ({
                  docs: [...docs.entries()]
                    .filter(([, d]) => d[field] instanceof Timestamp && (d[field] as Timestamp).toMillis() <= value.toMillis())
                    .sort(([, a], [, b]) => (a[field] as Timestamp).toMillis() - (b[field] as Timestamp).toMillis())
                    .slice(0, n)
                    .map(([id, d]) => ({ id, data: () => d })),
                }),
              }),
            }),
          };
        },
      };
    },
    getAll: async (...refs: Array<{ id: string }>) => refs.map(ref => snapshot(ref.id)),
  };
  return { db: db as unknown as Firestore, docs, queries };
}

const record = (url: string, nextAttemptAt: Date | null): AttemptRecord => ({
  url,
  source: 'rss',
  status: nextAttemptAt ? 'waiting-details' : 'done',
  lastOutcome: nextAttemptAt ? 'unannounced' : 'skipped',
  attemptCount: 1,
  unannouncedCount: nextAttemptAt ? 1 : 0,
  failureCount: 0,
  firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
  lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
  nextAttemptAt,
  publishedAt: new Date('2026-10-31T00:00:00Z'),
  publishedAtSource: 'rss',
});

describe('AttemptStore', () => {
  it('saves under the URL hash, as Timestamps, without undefined fields, and reads it back', async () => {
    const { db, docs } = fakeFirestore();
    const store = new AttemptStore(db);
    const saved = { ...record('https://a.example/1', new Date('2026-11-08T00:00:00Z')), title: undefined };
    await store.save(saved);

    const raw = docs.get(attemptDocId('https://a.example/1'));
    expect(raw?.nextAttemptAt).toBeInstanceOf(Timestamp);
    expect(raw).not.toHaveProperty('title');

    const read = await store.get('https://a.example/1');
    expect(read?.nextAttemptAt).toEqual(new Date('2026-11-08T00:00:00Z'));
    expect(read?.firstAttemptAt).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(await store.get('https://a.example/none')).toBeUndefined();
  });

  it('stores null for a URL that will not be tried again', async () => {
    const { db } = fakeFirestore();
    const store = new AttemptStore(db);
    await store.save(record('https://a.example/1', null));
    expect((await store.get('https://a.example/1'))?.nextAttemptAt).toBeNull();
  });

  it('finds which URLs were tried with one batched read', async () => {
    const { db } = fakeFirestore();
    const store = new AttemptStore(db);
    await store.save(record('https://a.example/1', null));
    const found = await store.findAttempted(['https://a.example/1', 'https://a.example/2', 'https://a.example/1']);
    expect([...found]).toEqual(['https://a.example/1']);
    expect(await store.findAttempted([])).toEqual(new Set());
  });

  it('finds due retries, longest-waiting first', async () => {
    const { db, queries } = fakeFirestore();
    const store = new AttemptStore(db);
    await store.save(record('https://a.example/late', new Date('2026-11-12T00:00:00Z')));
    await store.save(record('https://a.example/early', new Date('2026-11-05T00:00:00Z')));
    await store.save(record('https://a.example/future', new Date('2026-11-20T00:00:00Z')));
    await store.save(record('https://a.example/done', null));

    const due = await store.findDueRetries(new Date('2026-11-15T00:00:00Z'), 10);
    expect(due.map(r => r.url)).toEqual(['https://a.example/early', 'https://a.example/late']);
    expect(queries[0].slice(0, 2)).toEqual(['nextAttemptAt', '<=']);
  });
});
