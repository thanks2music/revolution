import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/venue/queries.ts` の分岐テスト (Layer 2 = 外部副作用境界)。
 *
 * mock の形は `__tests__/unit/lib/title/queries.test.ts` と同じ
 * (PostgREST 風チェーン + テーブル別の結果キュー)。検証したいのは
 * **戻り値の形に対する自分たちの分岐**であって PostgREST の挙動ではない。
 */

const mockCreatePublicClient = jest.fn();
const mockHasCredentials = jest.fn<() => boolean>();

jest.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mockCreatePublicClient(),
  hasPublicSupabaseCredentials: () => mockHasCredentials(),
}));

type QueryResult = { data: unknown; error: unknown };

/**
 * 記録する呼び出し。**`table` を持つ**のが `title` / `event` 側の mock との差分。
 *
 * `listVenueDetails` は `venues` (一覧) と `occurrence_view` (開催数の集計) の
 * 2 テーブルを引くため、`order` / `range` を全件まとめて数えると
 * 「venues の並びが name → slug であること」を検証しているつもりのアサーションが
 * 集計クエリの `order('id')` に汚染される。テーブル単位で絞れる形にしておく。
 */
type RecordedCall = { table: string; method: string; args: unknown[] };

/** 呼ばれたフィルタを記録しつつ結果へ解決する、PostgREST 風のチェーン。 */
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

function makeClient(
  byTable: Record<string, QueryResult | QueryResult[]>,
  calls: RecordedCall[] = [],
) {
  const queues = new Map<string, QueryResult[]>();
  for (const [table, value] of Object.entries(byTable)) {
    queues.set(table, Array.isArray(value) ? [...value] : [value]);
  }
  return {
    from: (table: string) => {
      const queue = queues.get(table);
      const result =
        queue && queue.length > 0
          ? queue.length > 1
            ? queue.shift()!
            : queue[0]
          : { data: null, error: null };
      return makeQuery(table, result, calls);
    },
  };
}

/** 指定テーブルに対する呼び出しだけを抜き出す。 */
const onTable = (calls: RecordedCall[], table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method);

// fixture は実データ由来 (staging の venues / events、2026-08-20 seed)。
const VENUE_ROW = {
  id: 7,
  slug: 'box-cafe-and-space-gems-shibuya',
  name: 'BOX cafe&space GEMS渋谷店',
  prefecture: '東京都',
  city: '渋谷区',
  address: '渋谷区渋谷1-1-1',
};

const OCCURRENCE_ROW = {
  id: 51,
  eventId: 5,
  slug: 'box-cafe-and-space-gems-shibuya',
  startsOn: '2026-07-01',
  endsOn: '2026-09-30',
  status: 'ongoing',
  events: { id: 5, name: '名探偵コナンカフェ' },
};

async function importQueries() {
  return await import('@/lib/venue/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listVenueParams', () => {
  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listVenueParams } = await importQueries();
    await expect(listVenueParams()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lists every venue slug', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: {
          data: [{ slug: 'animate-cafe-ikebukuro' }, { slug: 'box-cafe-and-space-gems-shibuya' }],
          error: null,
        },
      }),
    );

    const { listVenueParams } = await importQueries();
    await expect(listVenueParams()).resolves.toEqual([
      { slug: 'animate-cafe-ikebukuro' },
      { slug: 'box-cafe-and-space-gems-shibuya' },
    ]);
  });

  it('throws when credentials exist but the query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ venues: { data: null, error: { message: 'boom' } } }),
    );

    const { listVenueParams } = await importQueries();
    await expect(listVenueParams()).rejects.toThrow(/boom/);
  });
});

describe('listVenueDetails', () => {
  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);

    const { listVenueDetails } = await importQueries();
    await expect(listVenueDetails()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it('lists every venue row (including venues without occurrences)', async () => {
    // `/venues` 一覧の対象は `listVenueParams` と同じ集合でなければならない
    // (載っているのにページが無い = 404 リンクになる)。開催 0 件でも載せる。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: {
          data: [
            VENUE_ROW,
            { id: 8, slug: 'no-occurrence-venue', name: '開催なし会場', prefecture: null, city: null, address: null },
          ],
          error: null,
        },
      }),
    );

    const { listVenueDetails } = await importQueries();
    const details = await listVenueDetails();
    expect(details).toHaveLength(2);
    expect(details[1]).toMatchObject({ slug: 'no-occurrence-venue', prefecture: null });
  });
});

/**
 * ★ 集合一致の回帰テスト (`queryVenueRows` に 1 本化されていること)。
 *
 * `/venues` 一覧 (`listVenueDetails`) と静的生成 (`listVenueParams`) は
 * **同じ集合**でなければならない。別クエリとして 2 箇所に書くと、片方だけ
 * 条件が変わったときに黙って回帰する (2026-08-21 Codex レビュー指摘と同型)。
 */
describe('listVenueParams / listVenueDetails の集合一致', () => {
  it('returns the same slug set from the same filter and order', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    const rows = [
      VENUE_ROW,
      { id: 8, slug: 'no-occurrence-venue', name: '開催なし会場', prefecture: null, city: null, address: null },
    ];
    mockCreatePublicClient.mockReturnValue(makeClient({ venues: { data: rows, error: null } }, calls));

    const { listVenueParams, listVenueDetails } = await importQueries();
    const params = await listVenueParams();
    const details = await listVenueDetails();

    expect(params.map((p) => p.slug)).toEqual(details.map((d) => d.slug));

    // 絞り込み条件・並び順が共有されていること (order は name → slug の全順序)。
    // ⚠️ `venues` に対する order だけを見る (集計クエリの order('id') と混ぜない)。
    expect(onTable(calls, 'venues', 'order').map((c) => c.args[0])).toEqual([
      'name',
      'slug',
      'name',
      'slug',
    ]);
    // 対象を絞る述語を持たない (どちらも venues 全行)。
    expect(calls.some((c) => c.method === 'eq' || c.method === 'neq')).toBe(false);
  });

  it('paginates past the 500-row boundary in both functions (Codex #333 指摘)', async () => {
    // 静的生成対象 (`listVenueParams`) だけが 500 件で切れると、一覧との差分が
    // 404 リンクを生む。どちらかが単発 select に戻される回帰をここで検出する。
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    const fullPage = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1,
      slug: `venue-${String(index + 1).padStart(3, '0')}`,
      name: `会場 ${index + 1}`,
      prefecture: null,
      city: null,
      address: null,
    }));
    const lastRow = {
      id: 501,
      slug: 'venue-501',
      name: '会場 501',
      prefecture: null,
      city: null,
      address: null,
    };
    // 呼び出し順: params (page1, page2) → details (page1, page2)。
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          venues: [
            { data: fullPage, error: null },
            { data: [lastRow], error: null },
            { data: fullPage, error: null },
            { data: [lastRow], error: null },
          ],
        },
        calls,
      ),
    );

    const { listVenueParams, listVenueDetails } = await importQueries();
    const params = await listVenueParams();
    const details = await listVenueDetails();

    expect(params).toHaveLength(501);
    expect(details).toHaveLength(501);
    expect(params.map((p) => p.slug)).toEqual(details.map((d) => d.slug));

    // ⚠️ `venues` に対する range だけを見る (集計クエリのページングと混ぜない)。
    expect(onTable(calls, 'venues', 'range').map((c) => c.args)).toEqual([
      [0, 499],
      [500, 999],
      [0, 499],
      [500, 999],
    ]);
  });
});

/**
 * ★ 開催数の集計 (v6 #15 `▲ 要クエリ拡張`)。
 *
 * PR #333 の「MVP では開催数を置かない」判断を BOSS が意図的に上書きしたもの。
 * **集計を足しても対象集合は変わらない**ことを併せて固定する。
 */
describe('listVenueDetails の開催数集計', () => {
  const NO_OCCURRENCE_VENUE = {
    id: 8,
    slug: 'no-occurrence-venue',
    name: '開催なし会場',
    prefecture: null,
    city: null,
    address: null,
  };

  it('counts occurrences per venue and reports 0 for venues without any', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: [VENUE_ROW, NO_OCCURRENCE_VENUE], error: null },
        occurrence_view: {
          data: [{ venueId: 7 }, { venueId: 7 }, { venueId: 7 }],
          error: null,
        },
      }),
    );

    const { listVenueDetails } = await importQueries();
    const details = await listVenueDetails();
    expect(details.map((d) => [d.slug, d.occurrenceCount])).toEqual([
      [VENUE_ROW.slug, 3],
      [NO_OCCURRENCE_VENUE.slug, 0],
    ]);
  });

  it('ignores occurrences without a venue master (venue_id is null)', async () => {
    // 会場マスタを持たない開催 (`venue_label` だけ) が実データに存在する
    // (2026-08-22 実測 1 件)。どの会場の件数にも足さない。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: [VENUE_ROW], error: null },
        occurrence_view: {
          data: [{ venueId: 7 }, { venueId: null }, { venueId: null }],
          error: null,
        },
      }),
    );

    const { listVenueDetails } = await importQueries();
    const [venue] = await listVenueDetails();
    expect(venue.occurrenceCount).toBe(1);
  });

  it('paginates the count query past the 500-row boundary', async () => {
    // 集計は `occurrence_view` の全件走査。`db.max_rows` は黙って打ち切るため
    // page 化が必要 (会場ページ本体に入れたのと同じ防御)。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: [VENUE_ROW], error: null },
        occurrence_view: [
          { data: Array.from({ length: 500 }, () => ({ venueId: 7 })), error: null },
          { data: [{ venueId: 7 }], error: null },
        ],
      }),
    );

    const { listVenueDetails } = await importQueries();
    const [venue] = await listVenueDetails();
    expect(venue.occurrenceCount).toBe(501);
  });

  it('orders the count query by the base-table id (range ページングの全順序)', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          venues: { data: [VENUE_ROW], error: null },
          occurrence_view: { data: [{ venueId: 7 }], error: null },
        },
        calls,
      ),
    );

    const { listVenueDetails } = await importQueries();
    await listVenueDetails();

    const orders = onTable(calls, 'occurrence_view', 'order');
    expect(orders.map((c) => c.args[0])).toEqual(['id']);
    expect(orders[0].args[1]).not.toHaveProperty('referencedTable');
  });

  it('throws when the count query fails (0 件と混同しない)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: [VENUE_ROW], error: null },
        occurrence_view: { data: null, error: { message: 'venue counts boom' } },
      }),
    );

    const { listVenueDetails } = await importQueries();
    await expect(listVenueDetails()).rejects.toThrow(/venue counts boom/);
  });
});

describe('getVenueDetail', () => {
  it.each(['FOO', 'foo bar', 'foo--bar', '-foo', 'foo-', 'しぶや', ''])(
    'rejects non-canonical slug %j without querying',
    async (slug) => {
      mockHasCredentials.mockReturnValue(true);

      const { getVenueDetail } = await importQueries();
      await expect(getVenueDetail(slug)).resolves.toBeNull();
      expect(mockCreatePublicClient).not.toHaveBeenCalled();
    },
  );

  it('returns null when the venue does not exist', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ venues: { data: null, error: null } }),
    );

    const { getVenueDetail } = await importQueries();
    await expect(getVenueDetail('unknown-venue')).resolves.toBeNull();
  });

  it('throws when the venue query fails (エラーを「該当 0 件」と混同しない)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ venues: { data: null, error: { message: 'boom' } } }),
    );

    const { getVenueDetail } = await importQueries();
    await expect(getVenueDetail('box-cafe-and-space-gems-shibuya')).rejects.toThrow(/boom/);
  });

  it('returns groups: [] (not null) for a venue with no occurrences', async () => {
    // 開催 0 件の会場は notFound にしない (一覧・生成対象との集合一致を守る)。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: VENUE_ROW, error: null },
        occurrence_view: { data: [], error: null },
      }),
    );

    const { getVenueDetail } = await importQueries();
    const data = await getVenueDetail('box-cafe-and-space-gems-shibuya');
    expect(data).not.toBeNull();
    expect(data?.venue.name).toBe('BOX cafe&space GEMS渋谷店');
    expect(data?.groups).toEqual([]);
  });

  it('filters by venue_id (not slug) and orders by base-table columns', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          venues: { data: VENUE_ROW, error: null },
          occurrence_view: { data: [OCCURRENCE_ROW], error: null },
        },
        calls,
      ),
    );

    const { getVenueDetail } = await importQueries();
    const data = await getVenueDetail('box-cafe-and-space-gems-shibuya');

    expect(data?.groups).toHaveLength(1);
    expect(data?.groups[0]?.items[0]?.eventName).toBe('名探偵コナンカフェ');

    // 会場は slug で 1 件引き、開催の絞り込みは venue_id
    // (occurrences.slug は企画内ハンドルなので使わない)。
    expect(onTable(calls, 'venues', 'eq').map((c) => c.args)).toEqual([
      ['slug', 'box-cafe-and-space-gems-shibuya'],
    ]);
    expect(onTable(calls, 'occurrence_view', 'eq').map((c) => c.args)).toEqual([['venue_id', 7]]);

    // ページ境界の安定順序は基底テーブルの列 (starts_on → id)。
    // 埋め込み先 (`referencedTable`) の order を使わない。
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls.map((c) => c.args[0])).toEqual(['starts_on', 'id']);
    for (const call of orderCalls) {
      expect(call.args[1] ?? {}).not.toHaveProperty('referencedTable');
    }
  });

  it('paginates the occurrence query even for a single venue (db.max_rows 対策)', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    // 1 ページ目 = PAGE_SIZE (500) 行ちょうど → 2 ページ目まで読みに行く。
    const fullPage = Array.from({ length: 500 }, (_, index) => ({
      ...OCCURRENCE_ROW,
      id: index + 1,
    }));
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          venues: { data: VENUE_ROW, error: null },
          occurrence_view: [
            { data: fullPage, error: null },
            { data: [{ ...OCCURRENCE_ROW, id: 501 }], error: null },
          ],
        },
        calls,
      ),
    );

    const { getVenueDetail } = await importQueries();
    const data = await getVenueDetail('box-cafe-and-space-gems-shibuya');

    const total = data?.groups.reduce((sum, group) => sum + group.items.length, 0);
    expect(total).toBe(501);
    expect(calls.filter((c) => c.method === 'range')).toHaveLength(2);
  });

  it('throws when the occurrence query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        venues: { data: VENUE_ROW, error: null },
        occurrence_view: { data: null, error: { message: 'occ boom' } },
      }),
    );

    const { getVenueDetail } = await importQueries();
    await expect(getVenueDetail('box-cafe-and-space-gems-shibuya')).rejects.toThrow(/occ boom/);
  });
});
