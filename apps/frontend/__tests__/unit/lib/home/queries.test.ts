import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/home/queries.ts` のテスト。
 *
 * - `listOngoingOccurrences` = Layer 2 (外部副作用境界) → mock + 分岐の固定
 * - `pickOngoingTitles` = Layer 1 (純粋関数) → 直接呼ぶ
 */

const mockCreatePublicClient = jest.fn();
const mockHasCredentials = jest.fn<() => boolean>();

jest.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mockCreatePublicClient(),
  hasPublicSupabaseCredentials: () => mockHasCredentials(),
}));

type QueryResult = { data: unknown; error: unknown };
type RecordedCall = { table: string; method: string; args: unknown[] };

const onTable = (calls: RecordedCall[], table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method);

function makeQuery(table: string, result: QueryResult, calls: RecordedCall[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'range', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeClient(byTable: Record<string, QueryResult | QueryResult[]>, calls: RecordedCall[] = []) {
  const queues = new Map<string, QueryResult[]>();
  for (const [table, value] of Object.entries(byTable)) {
    queues.set(table, Array.isArray(value) ? [...value] : [value]);
  }
  return {
    from: (table: string) => {
      const queue = queues.get(table);
      const result =
        queue && queue.length > 0 ? (queue.length > 1 ? queue.shift()! : queue[0]) : { data: null, error: null };
      return makeQuery(table, result, calls);
    },
  };
}

/** staging の実データ由来の行 (2026-08-22 実測の形)。 */
const row = (over: Record<string, unknown> = {}) => ({
  id: 22,
  eventId: 8,
  slug: 'box-cafe-nagoya-1',
  startsOn: '2026-07-09',
  endsOn: '2026-08-23',
  venues: {
    slug: 'box-cafe-nagoya-1',
    name: 'BOX cafe&space グローバルゲート名古屋1号店',
    prefecture: '愛知県',
    city: '名古屋市中村区',
  },
  events: {
    id: 8,
    name: '呪術廻戦カフェ2026 5th Anniversary',
    primaryCategory: { name: 'コラボカフェ' },
    eventTitles: [{ titles: { slug: 'jujutsu-kaisen', name: '呪術廻戦' } }],
  },
  ...over,
});

async function importQueries() {
  return await import('@/lib/home/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listOngoingOccurrences', () => {
  it('returns [] without querying when credentials are absent', async () => {
    // トップは開催 0 件でも成立するページなので、資格情報が無いビルドでも
    // throw せずレンダリングを続ける (`listTitleParams` 等とは扱いが違う)。
    mockHasCredentials.mockReturnValue(false);

    const { listOngoingOccurrences } = await importQueries();
    await expect(listOngoingOccurrences()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it('resolves the 3-level embed into a flat card shape', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(makeClient({ occurrence_view: { data: [row()], error: null } }));

    const { listOngoingOccurrences } = await importQueries();
    const [card] = await listOngoingOccurrences();

    expect(card).toEqual({
      id: 22,
      eventId: 8,
      slug: 'box-cafe-nagoya-1',
      startsOn: '2026-07-09',
      endsOn: '2026-08-23',
      eventName: '呪術廻戦カフェ2026 5th Anniversary',
      categoryName: 'コラボカフェ',
      titles: [{ slug: 'jujutsu-kaisen', name: '呪術廻戦' }],
      venueName: 'BOX cafe&space グローバルゲート名古屋1号店',
      venueRegion: '愛知県 名古屋市中村区',
    });
  });

  it('tolerates null embeds (会場なし / 企画なし / 作品なし)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: {
          data: [row({ venues: null, events: null })],
          error: null,
        },
      }),
    );

    const { listOngoingOccurrences } = await importQueries();
    const [card] = await listOngoingOccurrences();

    // 企画名は fallback。会場が無ければ住所行を出さないよう空文字 / null にする。
    expect(card.eventName).toBe('企画情報なし');
    expect(card.categoryName).toBeNull();
    expect(card.titles).toEqual([]);
    expect(card.venueName).toBeNull();
    expect(card.venueRegion).toBe('');
  });

  it('joins only the non-null parts of the region', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: {
          data: [row({ venues: { slug: 'v', name: 'V', prefecture: '東京都', city: null } })],
          error: null,
        },
      }),
    );

    const { listOngoingOccurrences } = await importQueries();
    const [card] = await listOngoingOccurrences();
    expect(card.venueRegion).toBe('東京都');
  });

  it('sorts title chips in ja order (DB 任せにしない)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: {
          data: [
            row({
              events: {
                id: 6,
                name: 'STAR WARS CAFE',
                primaryCategory: null,
                eventTitles: [
                  { titles: { slug: 'mandalorian', name: 'マンダロリアン' } },
                  { titles: null },
                  { titles: { slug: 'star-wars', name: 'スター・ウォーズ' } },
                ],
              },
            }),
          ],
          error: null,
        },
      }),
    );

    const { listOngoingOccurrences } = await importQueries();
    const [card] = await listOngoingOccurrences();
    expect(card.titles.map((t) => t.name)).toEqual(['スター・ウォーズ', 'マンダロリアン']);
  });

  it('filters by status=ongoing and orders by base-table columns (ends_on → id)', async () => {
    // 終わりが近い順。埋め込み先の order は range ページングの全順序を壊す。
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: [row()], error: null } }, calls),
    );

    const { listOngoingOccurrences } = await importQueries();
    await listOngoingOccurrences();

    expect(onTable(calls, 'occurrence_view', 'eq').map((c) => c.args)).toEqual([
      ['status', 'ongoing'],
    ]);
    const orders = onTable(calls, 'occurrence_view', 'order');
    expect(orders.map((c) => c.args[0])).toEqual(['ends_on', 'id']);
    // 終了日未定 (null) は末尾へ。先頭に来ると「急ぎ」の並びが壊れる。
    expect(orders[0].args[1]).toMatchObject({ ascending: true, nullsFirst: false });
    for (const order of orders) {
      expect(order.args[1] ?? {}).not.toHaveProperty('referencedTable');
    }
  });

  it('paginates past the 500-row boundary', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: [
          { data: Array.from({ length: 500 }, (_, i) => row({ id: i + 1 })), error: null },
          { data: [row({ id: 501 })], error: null },
        ],
      }),
    );

    const { listOngoingOccurrences } = await importQueries();
    await expect(listOngoingOccurrences()).resolves.toHaveLength(501);
  });

  it('throws when the query fails (0 件と混同しない)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: null, error: { message: 'ongoing boom' } } }),
    );

    const { listOngoingOccurrences } = await importQueries();
    await expect(listOngoingOccurrences()).rejects.toThrow(/ongoing boom/);
  });
});

describe('pickOngoingTitles', () => {
  const card = (titles: { slug: string; name: string }[], id = 1) =>
    ({
      id,
      eventId: 1,
      slug: 's',
      startsOn: null,
      endsOn: null,
      eventName: 'e',
      categoryName: null,
      titles,
      venueName: null,
      venueRegion: '',
    }) as const;

  const A = { slug: 'a-title', name: 'あ作品' };
  const B = { slug: 'b-title', name: 'い作品' };
  const C = { slug: 'c-title', name: 'う作品' };

  it('ranks titles by ongoing occurrence count (descending)', async () => {
    const { pickOngoingTitles } = await importQueries();
    expect(
      pickOngoingTitles([card([A], 1), card([B], 2), card([A], 3), card([A], 4), card([B], 5)]),
    ).toEqual([
      { slug: 'a-title', name: 'あ作品', ongoingCount: 3 },
      { slug: 'b-title', name: 'い作品', ongoingCount: 2 },
    ]);
  });

  it('counts one occurrence once per title it belongs to (複数作品コラボ)', async () => {
    const { pickOngoingTitles } = await importQueries();
    expect(pickOngoingTitles([card([A, B, C], 1)]).map((p) => p.ongoingCount)).toEqual([1, 1, 1]);
  });

  it('breaks ties by ja name then slug (ビルドごとに順序が変わらない)', async () => {
    const { pickOngoingTitles } = await importQueries();
    // すべて 1 件なので、並びは名前順で決まる。
    expect(pickOngoingTitles([card([C], 1), card([A], 2), card([B], 3)]).map((p) => p.slug)).toEqual(
      ['a-title', 'b-title', 'c-title'],
    );
  });

  it('caps the list at TITLE_PICK_LIMIT (3 件固定にしない、BOSS 確定)', async () => {
    const { pickOngoingTitles, TITLE_PICK_LIMIT } = await importQueries();
    const many = Array.from({ length: TITLE_PICK_LIMIT + 5 }, (_, i) =>
      card([{ slug: `t-${i}`, name: `作品 ${i}` }], i),
    );
    expect(pickOngoingTitles(many)).toHaveLength(TITLE_PICK_LIMIT);
  });

  it('returns [] when nothing is ongoing (セクションごと出さないため)', async () => {
    const { pickOngoingTitles } = await importQueries();
    expect(pickOngoingTitles([])).toEqual([]);
    expect(pickOngoingTitles([card([])])).toEqual([]);
  });
});
