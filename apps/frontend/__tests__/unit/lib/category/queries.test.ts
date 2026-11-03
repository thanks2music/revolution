import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/category/queries.ts` の分岐テスト (Layer 2 = 外部副作用境界)。
 *
 * Supabase クライアントは丸ごと mock する。検証したいのは PostgREST の挙動ではなく、
 * 戻り値の形に対する自分たちの分岐 (資格情報なし / 失敗 / 予約語との衝突)。
 */

const mockCreatePublicClient = jest.fn();
const mockHasCredentials = jest.fn<() => boolean>();

jest.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mockCreatePublicClient(),
  hasPublicSupabaseCredentials: () => mockHasCredentials(),
}));

type QueryResult = { data: unknown; error: unknown };
type RecordedCall = { method: string; args: unknown[] };

function makeClient(result: QueryResult, calls: RecordedCall[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'range']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { from: () => chain };
}

const FIVE = [
  { slug: 'collabo-cafe', name: 'コラボカフェ' },
  { slug: 'pop-up-store', name: 'ポップアップストア' },
  { slug: 'exhibition', name: '原画展・展示会' },
  { slug: 'chain-store', name: 'チェーン店コラボ' },
  { slug: 'other', name: 'その他のイベント' },
];

async function importQueries() {
  return await import('@/lib/category/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listCategories', () => {
  it('returns [] without querying when credentials are absent (and says why)', async () => {
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listCategories } = await importQueries();
    await expect(listCategories()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads slug and name in id order', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: RecordedCall[] = [];
    mockCreatePublicClient.mockReturnValue(makeClient({ data: FIVE, error: null }, calls));

    const { listCategories } = await importQueries();
    await expect(listCategories()).resolves.toEqual(FIVE);
    expect(calls.find((c) => c.method === 'select')?.args).toEqual(['slug, name']);
    expect(calls.find((c) => c.method === 'order')?.args).toEqual(['id', { ascending: true }]);
  });

  it('throws when credentials exist but the query fails (0 件と混同しない)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(makeClient({ data: null, error: { message: 'boom' } }));

    const { listCategories } = await importQueries();
    await expect(listCategories()).rejects.toThrow(/boom/);
  });
});

describe('getCategory', () => {
  it('finds a category by slug, or null', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(makeClient({ data: FIVE, error: null }));

    const { getCategory } = await importQueries();
    await expect(getCategory('chain-store')).resolves.toEqual({
      slug: 'chain-store',
      name: 'チェーン店コラボ',
    });
    await expect(getCategory('events')).resolves.toBeNull();
  });
});

describe('listCategoryParams', () => {
  it('maps categories to route params', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(makeClient({ data: FIVE, error: null }));

    const { listCategoryParams } = await importQueries();
    await expect(listCategoryParams()).resolves.toEqual(
      FIVE.map((category) => ({ event_type: category.slug })),
    );
  });

  it('stops the build when a slug collides with a static top-level route', async () => {
    // `titles` という種別を作ると `/titles` は作品一覧に当たり、種別のページに届かなくなる。
    // (食い違いの検査より先に予約語の検査を通すため、定数側にも無い名前で試す)
    const { findReservedSlugs } = await import('@/lib/category/reserved-segments');
    expect(findReservedSlugs(['titles'])).toEqual(['titles']);
  });

  it('stops the build when the DB and EVENT_TYPE_SLUGS disagree', async () => {
    // 種別を DB にだけ足すと記事に出てこない種別が、定数にだけ足すと取り込みで保留になる種別が生まれる。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ data: [...FIVE.slice(0, 4), { slug: 'karaoke', name: 'カラオケ' }], error: null }),
    );

    const { listCategoryParams } = await importQueries();
    await expect(listCategoryParams()).rejects.toThrow(/DB だけ \[karaoke\] \/ 定数だけ \[other\]/);
  });

  it('skips the drift check when there are no categories (build without credentials)', async () => {
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listCategoryParams } = await importQueries();
    await expect(listCategoryParams()).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('diffEventTypes', () => {
  it('reports slugs only in the DB and only in the code', async () => {
    const { diffEventTypes } = await importQueries();
    expect(diffEventTypes(['collabo-cafe', 'pop-up-store', 'exhibition', 'chain-store', 'other'])).toEqual({
      onlyInDb: [],
      onlyInCode: [],
    });
    expect(diffEventTypes(['collabo-cafe', 'karaoke'])).toEqual({
      onlyInDb: ['karaoke'],
      onlyInCode: ['pop-up-store', 'exhibition', 'chain-store', 'other'],
    });
  });
});
