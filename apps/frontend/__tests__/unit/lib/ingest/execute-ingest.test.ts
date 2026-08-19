import { describe, expect, it } from '@jest/globals';

import { categories } from '@revolution/schemas/db/categories';
import { events } from '@revolution/schemas/db/events';
import { occurrences } from '@revolution/schemas/db/occurrences';
import { titleAliases } from '@revolution/schemas/db/title-aliases';
import { titles } from '@revolution/schemas/db/titles';
import { venueAliases } from '@revolution/schemas/db/venue-aliases';
import { venues } from '@revolution/schemas/db/venues';

import { executePlan, fetchSnapshot } from '@/lib/ingest/execute-ingest';
import type { IngestPlan } from '@/lib/ingest/plan-ingest';

/**
 * Layer 2 (外部副作用境界) の contract test。実 DB は使わず、drizzle の
 * 呼び出しチェーンを模した fake で以下を固定する:
 * - fetchSnapshot: 行 → Map の組み立て (venue alias の slug join /
 *   既存 occurrences の event slug キー化 / 迷子 eventId の黙殺)
 * - executePlan: insert / update の分岐と、event 単位の失敗隔離
 */

// --- fetchSnapshot 用: select().from(table) がテーブルごとの行を返す fake ---
function makeSelectDb(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => Promise.resolve(rowsByTable.get(table) ?? []),
    }),
  } as unknown as Parameters<typeof fetchSnapshot>[0];
}

describe('fetchSnapshot', () => {
  it('行データから照合用 Map を組み立てる (venue alias は venues.slug を join)', async () => {
    const db = makeSelectDb(
      new Map<unknown, unknown[]>([
        [categories, [{ id: 1, slug: 'collabo-cafe' }]],
        [titles, [{ id: 10, slug: 'detective-conan' }]],
        [titleAliases, [{ alias: 'meitantei-conan', titleId: 10 }]],
        [venues, [{ id: 100, slug: 'box-cafe-and-space-gems-shibuya' }]],
        [venueAliases, [{ alias: 'boxcafeandspacegems渋谷店', venueId: 100 }]],
        [events, [{ id: 500, slug: 'conan-cafe-2026' }]],
        [
          occurrences,
          [
            { eventId: 500, slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-04-10', endsOn: '2026-06-28' },
            // events に存在しない eventId の行は黙って落とす (孤児行の防御)
            { eventId: 999, slug: 'ghost', startsOn: null, endsOn: null },
          ],
        ],
      ]),
    );

    const snapshot = await fetchSnapshot(db);

    expect(snapshot.categoryIdBySlug.get('collabo-cafe')).toBe(1);
    expect(snapshot.titleIdBySlug.get('detective-conan')).toBe(10);
    expect(snapshot.titleIdByAlias.get('meitantei-conan')).toBe(10);
    expect(snapshot.venueIdBySlug.get('box-cafe-and-space-gems-shibuya')).toBe(100);
    expect(snapshot.venueByAlias.get('boxcafeandspacegems渋谷店')).toEqual({
      id: 100,
      slug: 'box-cafe-and-space-gems-shibuya',
    });
    expect(snapshot.existingOccurrences.get('conan-cafe-2026')).toEqual([
      { slug: 'box-cafe-and-space-gems-shibuya', startsOn: '2026-04-10', endsOn: '2026-06-28' },
    ]);
    expect([...snapshot.existingOccurrences.keys()]).toEqual(['conan-cafe-2026']);
  });

  it('venues に存在しない venueId を指す venue_alias は照合 Map に入れない', async () => {
    const db = makeSelectDb(
      new Map<unknown, unknown[]>([
        [venues, [{ id: 100, slug: 'known-venue' }]],
        [
          venueAliases,
          [
            { alias: 'known', venueId: 100 },
            { alias: 'orphan', venueId: 999 },
          ],
        ],
      ]),
    );

    const snapshot = await fetchSnapshot(db);

    expect(snapshot.venueByAlias.has('known')).toBe(true);
    expect(snapshot.venueByAlias.has('orphan')).toBe(false);
  });
});

// --- executePlan 用: insert/update チェーンを記録する fake トランザクション ---
interface RecordedCall {
  op: 'insert' | 'update';
  table: unknown;
  values: unknown;
}

function makeTxDb(options: { failOnEventSlug?: string } = {}) {
  const calls: RecordedCall[] = [];
  let nextEventId = 1;

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === events) {
          const eventValues = values as { slug: string };
          if (eventValues.slug === options.failOnEventSlug) {
            return {
              onConflictDoUpdate: () => ({
                returning: () => Promise.reject(new Error(`boom: ${eventValues.slug}`)),
              }),
            };
          }
          calls.push({ op: 'insert', table, values });
          return {
            onConflictDoUpdate: () => ({
              returning: () => Promise.resolve([{ id: nextEventId++ }]),
            }),
          };
        }
        calls.push({ op: 'insert', table, values });
        // occurrences の insert は直接 await され、event_titles 等は
        // onConflictDoNothing() が await されるため、両対応の thenable を返す
        return {
          onConflictDoNothing: () => Promise.resolve(undefined),
          then: (resolve: (value: undefined) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          calls.push({ op: 'update', table, values });
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  const db = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as Parameters<typeof executePlan>[0];

  return { db, calls };
}

function makePlan(overrides: Partial<IngestPlan> = {}): IngestPlan {
  return {
    events: [
      { slug: 'event-a', name: 'イベントA', primaryCategoryId: 1, officialUrl: null, articleSlugs: ['a1'] },
    ],
    eventTitles: [{ eventSlug: 'event-a', titleId: 10 }],
    eventCategories: [],
    occurrences: [
      {
        eventSlug: 'event-a',
        slug: 'venue-x',
        venueId: 100,
        venueLabel: '会場X',
        startsOn: '2026-08-20',
        endsOn: null,
        verified: true,
        action: 'insert',
      },
      {
        eventSlug: 'event-a',
        slug: 'venue-y',
        venueId: 101,
        venueLabel: '会場Y',
        startsOn: '2026-08-21',
        endsOn: null,
        verified: true,
        action: 'update',
      },
    ],
    queue: [],
    stats: { articles: 1, articlesSkipped: 0, occurrencesPlanned: 2, occurrencesQueued: 0 },
    ...overrides,
  };
}

describe('executePlan', () => {
  it('action に従って insert / update に分岐し、件数を正しく数える', async () => {
    const { db, calls } = makeTxDb();

    const result = await executePlan(db, makePlan());

    expect(result).toMatchObject({
      eventsUpserted: 1,
      occurrencesInserted: 1,
      occurrencesUpdated: 1,
      eventTitlesUpserted: 1,
      failures: [],
    });
    const occurrenceInserts = calls.filter((c) => c.op === 'insert' && c.table === occurrences);
    expect(occurrenceInserts).toHaveLength(1);
    expect(occurrenceInserts[0].values).toMatchObject({ slug: 'venue-x', eventId: 1, verified: true });
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ venueLabel: '会場Y' });
  });

  it('1 event の失敗は failures に隔離され、他 event の取り込みは続行する', async () => {
    const { db, calls } = makeTxDb({ failOnEventSlug: 'event-a' });
    const plan = makePlan({
      events: [
        { slug: 'event-a', name: 'A', primaryCategoryId: 1, officialUrl: null, articleSlugs: ['a1'] },
        { slug: 'event-b', name: 'B', primaryCategoryId: 1, officialUrl: null, articleSlugs: ['a2'] },
      ],
      eventTitles: [],
      occurrences: [
        {
          eventSlug: 'event-b',
          slug: 'venue-z',
          venueId: 102,
          venueLabel: '会場Z',
          startsOn: null,
          endsOn: null,
          verified: true,
          action: 'insert',
        },
      ],
    });

    const result = await executePlan(db, plan);

    expect(result.failures).toEqual([
      { eventSlug: 'event-a', message: 'boom: event-a' },
    ]);
    expect(result.eventsUpserted).toBe(1); // event-b のみ
    expect(result.occurrencesInserted).toBe(1);
    expect(calls.filter((c) => c.table === occurrences)).toHaveLength(1);
  });
});
