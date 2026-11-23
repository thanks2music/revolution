/**
 * Layer 2: reading detected links (written by the WEB checker), against a small in-memory Firestore.
 */
import { describe, expect, it } from '@jest/globals';
import type { Firestore } from 'firebase-admin/firestore';

import { DetectedLinkStore } from '@/lib/scheduled/detected-link-store';
import { DETECTED_LINKS_COLLECTION } from '@revolution/schemas/detected-link';

type Doc = Record<string, unknown>;

const NOW = new Date('2026-11-23T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function fakeFirestore(docs: Array<[string, Doc]>) {
  const db = {
    collection: (name: string) => {
      expect(name).toBe(DETECTED_LINKS_COLLECTION);
      return {
        where: (field: string, op: string, value: number) => {
          expect([field, op]).toEqual(['detectedAt', '>=']);
          return {
            get: async () => ({
              docs: docs
                .filter(([, data]) => typeof data.detectedAt === 'number' && data.detectedAt >= value)
                .map(([id, data]) => ({ id, data: () => data })),
            }),
          };
        },
      };
    },
  };
  return db as unknown as Firestore;
}

const link = (url: string, ageDays: number): Doc => ({
  url,
  targetId: 'target-1',
  targetTitle: 'サンプル公式サイト',
  detectedAt: NOW.getTime() - ageDays * DAY,
});

describe('DetectedLinkStore.listRecent', () => {
  it('reads links detected within the last 30 days, and skips a document that does not match the schema', async () => {
    const db = fakeFirestore([
      ['a', link('https://a.example/new', 1)],
      ['b', link('https://a.example/edge', 30)],
      ['c', link('https://a.example/old', 31)],
      ['d', { url: 'https://a.example/broken', detectedAt: NOW.getTime() }],
    ]);
    const logs: string[] = [];
    const links = await new DetectedLinkStore(db).listRecent(NOW, message => logs.push(message));

    expect(links.map(entry => entry.url)).toEqual(['https://a.example/new', 'https://a.example/edge']);
    expect(logs).toEqual([expect.stringContaining('d')]);
  });
});
