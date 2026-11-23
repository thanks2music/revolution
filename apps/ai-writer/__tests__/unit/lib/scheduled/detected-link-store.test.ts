/**
 * Layer 2: reading and marking detected links (written by the WEB checker), against a small
 * in-memory Firestore.
 */
import { describe, expect, it } from '@jest/globals';
import type { Firestore } from 'firebase-admin/firestore';

import { attemptDocId } from '@/lib/scheduled/attempt-url';
import { DetectedLinkStore } from '@/lib/scheduled/detected-link-store';
import { DETECTED_LINKS_COLLECTION, type DetectedLink } from '@revolution/schemas/detected-link';

type Doc = Record<string, unknown>;

function fakeFirestore(initial: Doc[]) {
  const docs = new Map<string, Doc>(initial.map(doc => [attemptDocId(String(doc.url)), { ...doc }]));
  const ref = (id: string) => ({ id });
  const db = {
    collection: (name: string) => {
      expect(name).toBe(DETECTED_LINKS_COLLECTION);
      return {
        doc: ref,
        where: (field: string, op: string, value: unknown) => {
          expect(op).toBe('==');
          return {
            get: async () => ({
              docs: [...docs.entries()]
                .filter(([, data]) => data[field] === value)
                .map(([id, data]) => ({ id, data: () => data })),
            }),
          };
        },
      };
    },
    getAll: async (...refs: Array<{ id: string }>) =>
      refs.map(r => ({ ref: r, exists: docs.has(r.id) })),
    batch: () => {
      const updates: Array<[string, Doc]> = [];
      return {
        update: (r: { id: string }, data: Doc) => updates.push([r.id, data]),
        commit: async () => {
          for (const [id, data] of updates) docs.set(id, { ...docs.get(id), ...data });
        },
      };
    },
  };
  return { db: db as unknown as Firestore, docs };
}

const link = (url: string, status: DetectedLink['status'] = 'pending'): DetectedLink => ({
  url,
  targetId: 'target-1',
  targetTitle: 'サンプル公式サイト',
  detectedAt: 1_700_000_000_000,
  status,
});

describe('DetectedLinkStore', () => {
  it('lists only pending links, and skips a document that does not match the schema', async () => {
    const { db } = fakeFirestore([
      link('https://a.example/1'),
      link('https://a.example/2', 'tried'),
      { url: 'https://a.example/broken', status: 'pending' },
    ]);
    const logs: string[] = [];
    const pending = await new DetectedLinkStore(db).listPending(message => logs.push(message));

    expect(pending.map(entry => entry.url)).toEqual(['https://a.example/1']);
    expect(logs).toEqual([expect.stringContaining(attemptDocId('https://a.example/broken'))]);
  });

  it('marks links by URL under the attempt record ID, skipping links that are gone', async () => {
    const { db, docs } = fakeFirestore([link('https://a.example/1'), link('https://a.example/2')]);
    await new DetectedLinkStore(db).mark(['https://a.example/1', 'https://a.example/gone', 'https://a.example/1'], 'tried');

    expect(docs.get(attemptDocId('https://a.example/1'))?.status).toBe('tried');
    expect(docs.get(attemptDocId('https://a.example/2'))?.status).toBe('pending');
    expect(docs.has(attemptDocId('https://a.example/gone'))).toBe(false);
  });
});
