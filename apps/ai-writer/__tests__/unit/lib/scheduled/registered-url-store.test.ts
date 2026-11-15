/**
 * Layer 2: the Firestore side of registered URLs, against a small in-memory Firestore.
 */
import { describe, expect, it } from '@jest/globals';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from '@/lib/scheduled/attempt-url';
import {
  AlreadyRegisteredError,
  REGISTERED_URLS_COLLECTION,
  RegisteredUrlStore,
} from '@/lib/scheduled/registered-url-store';

type Doc = Record<string, unknown>;

function fakeFirestore() {
  const docs = new Map<string, Doc>();
  const docRef = (id: string) => ({
    id,
    get: async () => ({ id, exists: docs.has(id), data: () => docs.get(id) }),
    create: async (data: Doc) => {
      if (docs.has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
      docs.set(id, data);
    },
    delete: async () => {
      docs.delete(id);
    },
  });
  const db = {
    collection: (name: string) => {
      expect(name).toBe(REGISTERED_URLS_COLLECTION);
      return {
        doc: docRef,
        orderBy: (field: string, direction: string) => ({
          get: async () => ({
            docs: [...docs.entries()]
              .sort(([, a], [, b]) => {
                const diff = (a[field] as Timestamp).toMillis() - (b[field] as Timestamp).toMillis();
                return direction === 'asc' ? diff : -diff;
              })
              .map(([id, data]) => ({ id, data: () => data })),
          }),
        }),
      };
    },
  };
  return { db: db as unknown as Firestore, docs };
}

describe('RegisteredUrlStore', () => {
  it('stores the URL, who and when under the same ID as the attempt record', async () => {
    const { db, docs } = fakeFirestore();
    const store = new RegisteredUrlStore(db);
    const now = new Date('2026-11-15T03:00:00Z');
    const entry = await store.add('https://a.example/1', 'boss@example.com', now);

    expect(entry.id).toBe(attemptDocId('https://a.example/1'));
    expect(docs.get(entry.id)).toEqual({
      url: 'https://a.example/1',
      createdBy: 'boss@example.com',
      createdAt: Timestamp.fromDate(now),
    });
    expect(await store.get(entry.id)).toEqual(entry);
  });

  it('refuses a URL that is already registered', async () => {
    const { db } = fakeFirestore();
    const store = new RegisteredUrlStore(db);
    await store.add('https://a.example/1', 'boss@example.com', new Date());
    await expect(store.add('https://a.example/1', 'boss@example.com', new Date())).rejects.toBeInstanceOf(
      AlreadyRegisteredError,
    );
  });

  it('passes on other Firestore errors', async () => {
    const failing = {
      collection: () => ({
        doc: () => ({ create: async () => Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })) }),
      }),
    } as unknown as Firestore;
    await expect(new RegisteredUrlStore(failing).add('https://a.example/1', 'x', new Date())).rejects.toThrow(
      'UNAVAILABLE',
    );
  });

  it('lists the oldest registration first, and removes one', async () => {
    const { db } = fakeFirestore();
    const store = new RegisteredUrlStore(db);
    const newer = await store.add('https://a.example/new', 'boss@example.com', new Date('2026-11-14T00:00:00Z'));
    await store.add('https://a.example/old', 'boss@example.com', new Date('2026-11-10T00:00:00Z'));

    expect((await store.list()).map(entry => entry.url)).toEqual(['https://a.example/old', 'https://a.example/new']);
    await store.remove(newer.id);
    expect((await store.list()).map(entry => entry.url)).toEqual(['https://a.example/old']);
    expect(await store.get(newer.id)).toBeUndefined();
  });
});
