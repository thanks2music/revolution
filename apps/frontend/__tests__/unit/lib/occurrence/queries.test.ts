import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/occurrence/queries.ts` の分岐テスト (Layer 2 = 外部副作用境界)。
 *
 * ## 何を固定したいか
 *
 * 本ファイルの要点は「**暗黙に壊れる経路を作らない**」こと。よって
 * 素通りしうる分岐を優先して固定する:
 *
 * - 資格情報が無いとき静的生成をスキップする (throw しない)
 * - 資格情報があってクエリが失敗したときは throw する (0 件と混同しない)
 * - 不正な `eventId` は **問い合わせずに** null (DB へ無駄に投げない)
 * - 会場名の解決順序 (venues マスタ → venue_label → null)。**slug で代用しない**
 *
 * Supabase クライアントは丸ごと mock する。ここで検証したいのは PostgREST の
 * 挙動ではなく、**戻り値の形に対する自分たちの分岐**であるため。
 */

const mockCreatePublicClient = jest.fn();
const mockHasCredentials = jest.fn<() => boolean>();

jest.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mockCreatePublicClient(),
  hasPublicSupabaseCredentials: () => mockHasCredentials(),
}));

/**
 * PostgREST のクエリビルダを模したチェーン。`.select().eq().neq().order()` の
 * どの順で呼ばれても最後に `result` へ解決する thenable を返す。
 */
function makeQuery(
  result: { data: unknown; error: unknown },
  calls: { method: string; args: unknown[] }[] = [],
) {
  const chain: Record<string, unknown> = {};
  // `range` を含めること。`generateStaticParams` 用のクエリは max-rows で
  // 無言に打ち切られるのを避けるためページングしている (`lib/supabase/paginate.ts`)。
  for (const method of ['select', 'eq', 'neq', 'order', 'in', 'range']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

type QueryResult = { data: unknown; error: unknown };

/**
 * テーブル名 → 返す結果、で mock クライアントを組み立てる。
 *
 * 値に配列を渡すと**呼び出し順**に消費する。`occurrence_view` は
 * 「開催本体 (maybeSingle)」と「他の開催 (siblings)」で 2 回引かれるため、
 * 両者に別の結果を返せる必要がある。
 */
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
      // 最後の 1 件は使い回す (同じ結果を何度も書かせない)。
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

/**
 * 検証を通る最小の occurrence 行。
 *
 * `venues` は PostgREST の**埋め込み結果**。会場マスタを持たない開催では null。
 * (2026-08-14 に別クエリ + Map 解決から埋め込みへ変更)
 */
const OCCURRENCE_ROW = {
  id: 1,
  eventId: 2,
  venueLabel: null,
  slug: 'tokyo-shibuya',
  startsOn: '2026-08-04',
  endsOn: '2026-09-08',
  status: 'ongoing',
  venues: null,
};

const EVENT_ROW = {
  id: 2,
  slug: 'seed-cafe',
  name: 'シード企画',
  description: null,
  officialUrl: null,
};

async function importQueries() {
  return await import('@/lib/occurrence/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listOccurrenceParams', () => {
  it('returns [] without querying when credentials are absent', async () => {
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listOccurrenceParams } = await importQueries();
    await expect(listOccurrenceParams()).resolves.toEqual([]);

    // 資格情報が無いビルドで DB を触らないこと (CI が落ちた原因そのもの)。
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
    // 黙って 0 件にせず、理由をログに残すこと。
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when credentials exist but the query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: null, error: { message: 'boom' } } }),
    );

    const { listOccurrenceParams } = await importQueries();
    // ここを握り潰すと、本番ビルドで DB が落ちても 0 ページで静かに成功する。
    await expect(listOccurrenceParams()).rejects.toThrow(/boom/);
  });

  it('maps rows to route params', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: {
          data: [
            { eventId: 2, slug: 'tokyo-shibuya' },
            { eventId: 3, slug: 'osaka-umeda' },
          ],
          error: null,
        },
      }),
    );

    const { listOccurrenceParams } = await importQueries();
    await expect(listOccurrenceParams()).resolves.toEqual([
      { id: '2', occurrence_slug: 'tokyo-shibuya' },
      { id: '3', occurrence_slug: 'osaka-umeda' },
    ]);
  });

  it('treats zero rows as a normal state, not an error', async () => {
    // S3 が繋がるまで本番は 0 件。ここで throw すると本番ビルドが落ちる。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: [], error: null } }),
    );

    const { listOccurrenceParams } = await importQueries();
    await expect(listOccurrenceParams()).resolves.toEqual([]);
  });
});

describe('getOccurrenceDetail', () => {
  it.each(['abc', '', '0', '-1', '1.5', 'NaN'])(
    'returns null without querying for invalid event id %p',
    async (raw) => {
      mockHasCredentials.mockReturnValue(true);
      const { getOccurrenceDetail } = await importQueries();

      await expect(getOccurrenceDetail(raw, 'tokyo-shibuya')).resolves.toBeNull();
      expect(mockCreatePublicClient).not.toHaveBeenCalled();
    },
  );

  it('returns null when the occurrence does not exist', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: null, error: null } }),
    );

    const { getOccurrenceDetail } = await importQueries();
    await expect(getOccurrenceDetail('2', 'nope')).resolves.toBeNull();
  });

  it('throws when the occurrence query itself fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: null, error: { message: 'network down' } } }),
    );

    const { getOccurrenceDetail } = await importQueries();
    await expect(getOccurrenceDetail('2', 'tokyo-shibuya')).rejects.toThrow(/network down/);
  });

  /**
   * ★ PR #302 のレビューで指摘された実バグの回帰テスト。
   *
   * `eventResult.error` しか見ていなかったため、他のクエリが失敗しても
   * `data: null` が「0 件」として扱われ、**実在する開催が黙って消える**
   * という壊れ方をしていた。画面上は正常に見えるので気づけない類の欠陥。
   *
   * ⚠️ クエリ構成は 2026-08-14 に変わっている (会場は埋め込みへ、siblings は
   *    本体と同じ 1 クエリから JS で分離)。よって検査対象は 3 つ。
   */
  it.each([
    ['occurrence_view', 'occurrences lookup failed'],
    ['events', 'event lookup failed'],
    ['event_titles', 'titles lookup failed'],
  ])('throws when the %s query fails instead of showing empty data', async (table, message) => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: { data: [OCCURRENCE_ROW], error: null },
        events: { data: EVENT_ROW, error: null },
        event_titles: { data: [], error: null },
        [table]: { data: null, error: { message } },
      }),
    );

    const { getOccurrenceDetail } = await importQueries();
    await expect(getOccurrenceDetail('2', 'tokyo-shibuya')).rejects.toThrow(new RegExp(message));
  });

  /**
   * 本体と siblings を**同じ 1 クエリ**から分けていることを固定する。
   *
   * 述語だけ変えて 2 回叩くと、クエリが 1 本増えるうえ「本体が返るまで
   * siblings を投げられない」依存が生まれる (PR #303 レビュー指摘)。
   */
  it('splits the body and siblings from a single occurrence query', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: { method: string; args: unknown[] }[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          occurrence_view: {
            data: [
              OCCURRENCE_ROW,
              { ...OCCURRENCE_ROW, id: 2, slug: 'osaka-umeda' },
              { ...OCCURRENCE_ROW, id: 3, slug: 'aichi-sakae' },
            ],
            error: null,
          },
          events: { data: EVENT_ROW, error: null },
          event_titles: { data: [], error: null },
        },
        calls,
      ),
    );

    const { getOccurrenceDetail } = await importQueries();
    const result = await getOccurrenceDetail('2', 'tokyo-shibuya');

    expect(result?.occurrence.slug).toBe('tokyo-shibuya');
    expect(result?.siblings.map((s) => s.slug)).toEqual(['osaka-umeda', 'aichi-sakae']);
    // 本体の絞り込みを DB 側でやっていないこと (slug の等値フィルタが無い)。
    expect(calls.filter((c) => c.method === 'eq' && c.args[0] === 'slug')).toHaveLength(0);
  });

  it('returns null when the requested slug is not among the event occurrences', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: { data: [OCCURRENCE_ROW], error: null },
        events: { data: EVENT_ROW, error: null },
        event_titles: { data: [], error: null },
      }),
    );

    const { getOccurrenceDetail } = await importQueries();
    await expect(getOccurrenceDetail('2', 'nope')).resolves.toBeNull();
  });
});

/**
 * 会場表示名の解決 (Layer 1、純粋関数)。
 *
 * 以前は取得層の `attachVenueNames` が追加クエリ + Map で解決していたが、
 * **view でも PostgREST の埋め込みが効く**ことが実測で分かったため
 * (2026-08-14)、埋め込み結果からの純粋な解決に変わった。
 * 規則そのものは変えていないので、ここで固定し続ける。
 */
describe('resolveVenueName', () => {
  const row = {
    id: 1,
    eventId: 2,
    venueLabel: null as string | null,
    slug: 'slug',
    startsOn: '2026-08-01',
    endsOn: '2026-09-01',
    status: 'ongoing' as const,
    venues: null as { slug: string; name: string; prefecture: string | null; city: string | null; address: string | null } | null,
  };

  it('prefers the venue master name', async () => {
    const { resolveVenueName } = await importQueries();
    expect(
      resolveVenueName({
        ...row,
        venueLabel: 'ラベル',
        venues: { slug: 'v', name: 'マスタ由来の会場', prefecture: null, city: null, address: null },
      }),
    ).toBe('マスタ由来の会場');
  });

  it('falls back to venue_label when there is no master row', async () => {
    const { resolveVenueName } = await importQueries();
    expect(resolveVenueName({ ...row, venueLabel: 'ラベルだけの会場' })).toBe('ラベルだけの会場');
  });

  it('returns null instead of substituting the slug', async () => {
    // slug は URL 用の識別子であって人が読む名前ではない。
    const { resolveVenueName } = await importQueries();
    expect(resolveVenueName({ ...row, slug: 'tokyo-shibuya' })).toBeNull();
  });
});
