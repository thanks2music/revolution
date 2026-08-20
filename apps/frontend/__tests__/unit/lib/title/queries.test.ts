import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/title/queries.ts` の分岐テスト (Layer 2 = 外部副作用境界)。
 *
 * mock の形は `__tests__/unit/lib/event/queries.test.ts` と同じ
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

/** 呼ばれたフィルタを記録しつつ結果へ解決する、PostgREST 風のチェーン。 */
function makeQuery(result: QueryResult, calls: { method: string; args: unknown[] }[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'range', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeClient(
  byTable: Record<string, QueryResult | QueryResult[]>,
  calls: { method: string; args: unknown[] }[] = [],
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
      return makeQuery(result, calls);
    },
  };
}

// fixture は実データ由来 (staging の titles / events、2026-08-20 実測)。
const TITLE_ROW = {
  slug: 'detective-conan',
  name: '名探偵コナン',
  nameKana: null,
  kind: 'manga',
};

const EVENT_TITLE_ROWS = [
  {
    events: { id: 5, slug: 'detective-conan-cafe-2026', name: '名探偵コナンカフェ', ratingCount: 0 },
    titles: { slug: 'detective-conan' },
  },
];

const OCCURRENCE_ROW = {
  id: 51,
  eventId: 5,
  venueLabel: null,
  slug: 'box-cafe-and-space-gems-shibuya',
  startsOn: '2026-07-01',
  endsOn: '2026-09-30',
  status: 'ongoing',
  venues: null,
};

async function importQueries() {
  return await import('@/lib/title/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listTitleParams', () => {
  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listTitleParams } = await importQueries();
    await expect(listTitleParams()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lists every title slug', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: [{ slug: 'detective-conan' }, { slug: 'jujutsu-kaisen' }], error: null },
      }),
    );

    const { listTitleParams } = await importQueries();
    await expect(listTitleParams()).resolves.toEqual([
      { slug: 'detective-conan' },
      { slug: 'jujutsu-kaisen' },
    ]);
  });

  it('throws when credentials exist but the query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ titles: { data: null, error: { message: 'boom' } } }),
    );

    const { listTitleParams } = await importQueries();
    await expect(listTitleParams()).rejects.toThrow(/boom/);
  });
});

describe('listTitleDetails', () => {
  it('lists every title row (including titles without events)', async () => {
    // `/titles` 一覧の対象は `listTitleParams` と同じ集合でなければならない
    // (載っているのにページが無い = 404 リンクになる)。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: {
          data: [TITLE_ROW, { slug: 'pochacco', name: 'ポチャッコ', nameKana: null, kind: 'other' }],
          error: null,
        },
      }),
    );

    const { listTitleDetails } = await importQueries();
    await expect(listTitleDetails()).resolves.toEqual([
      TITLE_ROW,
      { slug: 'pochacco', name: 'ポチャッコ', nameKana: null, kind: 'other' },
    ]);
  });

  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);

    const { listTitleDetails } = await importQueries();
    await expect(listTitleDetails()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });
});

describe('listTitleEventSlugPairs', () => {
  it('flattens event_titles into (titleSlug, titleName, eventSlug), dropping null embeds', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        event_titles: {
          data: [
            {
              titles: { slug: 'detective-conan', name: '名探偵コナン' },
              events: { slug: 'detective-conan-cafe-2026' },
            },
            { titles: null, events: { slug: 'orphan' } },
          ],
          error: null,
        },
      }),
    );

    const { listTitleEventSlugPairs } = await importQueries();
    await expect(listTitleEventSlugPairs()).resolves.toEqual([
      {
        titleSlug: 'detective-conan',
        titleName: '名探偵コナン',
        eventSlug: 'detective-conan-cafe-2026',
      },
    ]);
  });

  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);

    const { listTitleEventSlugPairs } = await importQueries();
    await expect(listTitleEventSlugPairs()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });
});

describe('getTitleLinkSources', () => {
  it('returns the master lookup for article title chips', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: [TITLE_ROW], error: null },
        event_titles: {
          data: [
            {
              titles: { slug: 'detective-conan', name: '名探偵コナン' },
              events: { slug: 'detective-conan-cafe-2026' },
            },
          ],
          error: null,
        },
      }),
    );

    const { getTitleLinkSources } = await importQueries();
    await expect(getTitleLinkSources()).resolves.toEqual({
      titles: [TITLE_ROW],
      pairs: [
        {
          titleSlug: 'detective-conan',
          titleName: '名探偵コナン',
          eventSlug: 'detective-conan-cafe-2026',
        },
      ],
    });
  });

  /**
   * ★ 記事を DB 障害の人質にしないための回帰テスト。
   *
   * 記事本文は fs 由来なので、DB が落ちていてもページは出さなければならない。
   * ここで throw すると Supabase の一時障害で**記事ページ全部がビルド不能**になる
   * (`app/sitemap.ts` が「種別ごとに独立して劣化させる」で直したのと同じ結合)。
   */
  it('degrades to an empty lookup instead of throwing when the DB fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: null, error: { message: 'db down' } },
        event_titles: { data: null, error: { message: 'db down' } },
      }),
    );

    const { getTitleLinkSources } = await importQueries();
    await expect(getTitleLinkSources()).resolves.toEqual({ titles: [], pairs: [] });

    // 黙って空にしない。Sentry へ warning で届くことまで固定する。
    const sentry = (await import('@sentry/nextjs')) as unknown as { captureMessage: jest.Mock };
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        fingerprint: ['article-title-links-unavailable'],
      }),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('getTitleHubData', () => {
  it.each(['FOO', 'foo bar', 'foo--bar', '-foo', 'foo-', 'じゅじゅつ', ''])(
    'returns null without querying for a non-canonical slug %p',
    async (raw) => {
      mockHasCredentials.mockReturnValue(true);
      const { getTitleHubData } = await importQueries();

      await expect(getTitleHubData(raw)).resolves.toBeNull();
      expect(mockCreatePublicClient).not.toHaveBeenCalled();
    },
  );

  it('returns null when the title does not exist', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: null, error: null },
        event_titles: { data: [], error: null },
      }),
    );

    const { getTitleHubData } = await importQueries();
    await expect(getTitleHubData('unknown-title')).resolves.toBeNull();
  });

  it('assembles title, event groups and the event slug set', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: TITLE_ROW, error: null },
        event_titles: { data: EVENT_TITLE_ROWS, error: null },
        occurrence_view: { data: [OCCURRENCE_ROW], error: null },
      }),
    );

    const { getTitleHubData } = await importQueries();
    const data = await getTitleHubData('detective-conan');

    expect(data?.title).toEqual(TITLE_ROW);
    expect(data?.eventGroups).toHaveLength(1);
    expect(data?.eventGroups[0].event.id).toBe(5);
    expect(data?.eventGroups[0].occurrences.map((o) => o.slug)).toEqual([
      'box-cafe-and-space-gems-shibuya',
    ]);
    // 記事の紐付けキー。開催 0 件の企画も含む「全企画の slug」であること。
    expect(data?.eventSlugs).toEqual(new Set(['detective-conan-cafe-2026']));
  });

  it('keeps events without published occurrences in eventSlugs but not in eventGroups', async () => {
    // 開催が未公開 (verified=false → anon には 0 行) の企画: 企画カードは
    // 出さない (空ページへリンクしない) が、記事の紐付けには使う
    // (記事の公開は occurrence の verified と独立)。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: TITLE_ROW, error: null },
        event_titles: {
          data: [
            ...EVENT_TITLE_ROWS,
            {
              events: { id: 9, slug: 'not-yet-verified', name: '未公開企画', ratingCount: 0 },
              titles: { slug: 'detective-conan' },
            },
          ],
          error: null,
        },
        occurrence_view: { data: [OCCURRENCE_ROW], error: null },
      }),
    );

    const { getTitleHubData } = await importQueries();
    const data = await getTitleHubData('detective-conan');

    expect(data?.eventGroups.map((g) => g.event.id)).toEqual([5]);
    expect(data?.eventSlugs).toEqual(
      new Set(['detective-conan-cafe-2026', 'not-yet-verified']),
    );
  });

  it('skips the occurrence query when the title has no events', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: { method: string; args: unknown[] }[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          titles: { data: TITLE_ROW, error: null },
          event_titles: { data: [], error: null },
          occurrence_view: { data: null, error: { message: 'must not be called' } },
        },
        calls,
      ),
    );

    const { getTitleHubData } = await importQueries();
    const data = await getTitleHubData('detective-conan');

    expect(data?.eventGroups).toEqual([]);
    expect(data?.eventSlugs).toEqual(new Set());
    // occurrence_view のエラーが throw されていない = クエリ自体を省いている。
    expect(calls.some((c) => c.method === 'in')).toBe(false);
  });

  it.each([
    ['titles', 'title lookup failed'],
    ['event_titles', 'event lookup failed'],
  ])('throws when the %s query fails instead of showing empty data', async (table, message) => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: TITLE_ROW, error: null },
        event_titles: { data: [], error: null },
        [table]: { data: null, error: { message } },
      }),
    );

    const { getTitleHubData } = await importQueries();
    await expect(getTitleHubData('detective-conan')).rejects.toThrow(new RegExp(message));
  });

  it('throws when the occurrence query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        titles: { data: TITLE_ROW, error: null },
        event_titles: { data: EVENT_TITLE_ROWS, error: null },
        occurrence_view: { data: null, error: { message: 'occ boom' } },
      }),
    );

    const { getTitleHubData } = await importQueries();
    await expect(getTitleHubData('detective-conan')).rejects.toThrow(/occ boom/);
  });
});
