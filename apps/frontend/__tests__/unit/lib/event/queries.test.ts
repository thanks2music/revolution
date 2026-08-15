import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `lib/event/queries.ts` の分岐テスト (Layer 2 = 外部副作用境界)。
 *
 * ## 何を固定したいか
 *
 * 「黙って少なく見える」経路を優先して固定する。企画ページの
 * 「同じ作品の他の企画」は**存在するのに空に見えても誰も気づかない**種類の
 * セクションなので、目減りの原因を 1 つずつテストで押さえる。
 *
 * Supabase クライアントは丸ごと mock する。検証したいのは PostgREST の挙動では
 * なく、**戻り値の形に対する自分たちの分岐**であるため。
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

const EVENT_ROW = {
  id: 2,
  slug: 'seed-cafe',
  name: 'シード企画',
  description: null,
  officialUrl: null,
};

async function importQueries() {
  return await import('@/lib/event/queries');
}

beforeEach(() => {
  jest.resetModules();
  mockCreatePublicClient.mockReset();
  mockHasCredentials.mockReset();
});

describe('listEventParams', () => {
  it('returns [] without querying when credentials are absent', async () => {
    // 導出元 (listOccurrenceParams) が資格情報チェックを持つので、
    // 企画側は自前でチェックしない = 判定が 1 箇所に閉じる。
    mockHasCredentials.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { listEventParams } = await importQueries();
    await expect(listEventParams()).resolves.toEqual([]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('collapses one row per occurrence into one param per event', async () => {
    // occurrence_view は開催ごとに 1 行返るので、同じ企画が開催数だけ出てくる。
    // ★ 2026-08-14 以降、listEventParams は **listOccurrenceParams から導出**する
    //   (同じ view の全件走査を 2 周させない / 「静的生成対象の企画」の定義を
    //    1 箇所に保つ)。よって mock も開催列挙のクエリ形に合わせる。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        occurrence_view: {
          data: [
            { eventId: 2, slug: 'a' },
            { eventId: 2, slug: 'b' },
            { eventId: 3, slug: 'c' },
            { eventId: 2, slug: 'd' },
          ],
          error: null,
        },
      }),
    );

    const { listEventParams } = await importQueries();
    await expect(listEventParams()).resolves.toEqual([{ id: '2' }, { id: '3' }]);
  });

  it('throws when credentials exist but the query fails', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({ occurrence_view: { data: null, error: { message: 'boom' } } }),
    );

    const { listEventParams } = await importQueries();
    await expect(listEventParams()).rejects.toThrow(/boom/);
  });
});

describe('getEventDetail', () => {
  it.each(['abc', '', '0', '-1', '2.0', '0x2', '02'])(
    'returns null without querying for a non-canonical id %p',
    async (raw) => {
      mockHasCredentials.mockReturnValue(true);
      const { getEventDetail } = await importQueries();

      await expect(getEventDetail(raw)).resolves.toBeNull();
      expect(mockCreatePublicClient).not.toHaveBeenCalled();
    },
  );

  it('returns null when the event does not exist', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(makeClient({ events: { data: null, error: null } }));

    const { getEventDetail } = await importQueries();
    await expect(getEventDetail('999')).resolves.toBeNull();
  });

  it.each([
    ['event_titles', 'titles lookup failed'],
    ['occurrence_view', 'occurrences lookup failed'],
  ])('throws when the %s query fails instead of showing empty data', async (table, message) => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        events: { data: EVENT_ROW, error: null },
        event_titles: { data: [], error: null },
        occurrence_view: { data: [], error: null },
        [table]: { data: null, error: { message } },
      }),
    );

    const { getEventDetail } = await importQueries();
    await expect(getEventDetail('2')).rejects.toThrow(new RegExp(message));
  });
});

describe('findRelatedEvents (via getEventDetail)', () => {
  /**
   * ★ PR #303 レビューで指摘された自己混入バグの回帰テスト。
   *
   * `titleSlugs` は**自分自身の作品 slug 一覧**なので、`event_titles` をこの条件で
   * 引くと対象企画自身が**作品数だけヒットする**。旧実装は「自分が 1 件混ざる」
   * 前提で `limit(LIMIT + 1)` としており、2 作品以上に紐づく企画では自分自身が
   * 2 行以上を占めて、本来表示すべき関連企画を取得ウィンドウから押し出していた。
   *
   * 修正では `neq('events.id', ...)` でクエリの時点から自分を除く。
   */
  it('excludes itself in the query, not by over-fetching', async () => {
    mockHasCredentials.mockReturnValue(true);
    const calls: { method: string; args: unknown[] }[] = [];
    mockCreatePublicClient.mockReturnValue(
      makeClient(
        {
          events: { data: EVENT_ROW, error: null },
          // 自分自身が 3 作品に紐づく = 旧実装なら 3 行を自分で占有していた
          event_titles: [
            {
              data: [
                { titles: { slug: 'w1', name: 'W1' } },
                { titles: { slug: 'w2', name: 'W2' } },
                { titles: { slug: 'w3', name: 'W3' } },
              ],
              error: null,
            },
            { data: [{ events: { id: 7, name: '関連企画' } }], error: null },
          ],
          occurrence_view: [
            { data: [], error: null }, // 自分の開催
            { data: [{ eventId: 7 }], error: null }, // 関連企画の公開判定
          ],
        },
        calls,
      ),
    );

    const { getEventDetail } = await importQueries();
    const result = await getEventDetail('2');

    // 自己除外がクエリ側で行われていること。
    const neq = calls.filter((c) => c.method === 'neq');
    expect(neq).toEqual(
      expect.arrayContaining([{ method: 'neq', args: ['events.id', 2] }]),
    );

    // 候補ウィンドウが表示上限と同値でないこと (同値だと目減りで空に見える)。
    const limits = calls.filter((c) => c.method === 'limit').map((c) => c.args[0]);
    expect(limits.every((l) => typeof l === 'number' && l > 12)).toBe(true);

    expect(result?.relatedEvents).toEqual([{ id: 7, name: '関連企画' }]);
  });

  it('drops related events that have no published occurrence (no links to empty pages)', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        events: { data: EVENT_ROW, error: null },
        event_titles: [
          { data: [{ titles: { slug: 'w1', name: 'W1' } }], error: null },
          {
            data: [
              { events: { id: 7, name: '開催あり' } },
              { events: { id: 8, name: '開催なし' } },
            ],
            error: null,
          },
        ],
        occurrence_view: [
          { data: [], error: null }, // 自分の開催
          { data: [{ eventId: 7 }], error: null }, // 8 は返らない = 非公開
        ],
      }),
    );

    const { getEventDetail } = await importQueries();
    const result = await getEventDetail('2');

    expect(result?.relatedEvents).toEqual([{ id: 7, name: '開催あり' }]);
  });

  /**
   * 候補ウィンドウ上限 (200 行) に張り付いた = 関連企画を取りこぼしている可能性がある。
   *
   * console.warn だけでは Vercel のランタイムログに埋もれて誰も気づけないため、
   * Sentry へ warning として届くことを固定する。level は warning 止まり
   * (表示に漏れが出うるだけで機能は動いており「起きて対応すべき」ではない)。
   * fingerprint を固定しないと event_id ごとに Issue が増えて無料枠を食う。
   */
  it('reports to Sentry as a warning when the candidate window is saturated', async () => {
    mockHasCredentials.mockReturnValue(true);
    const CANDIDATE_ROWS = 200;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockCreatePublicClient.mockReturnValue(
      makeClient({
        events: { data: EVENT_ROW, error: null },
        event_titles: [
          { data: [{ titles: { slug: 'w1', name: 'W1' } }], error: null },
          // ちょうど上限行数を返す = 取りこぼしの疑いがある状態
          {
            data: Array.from({ length: CANDIDATE_ROWS }, (_, i) => ({
              events: { id: 1000 + i, name: `関連 ${i}` },
            })),
            error: null,
          },
        ],
        occurrence_view: [
          { data: [], error: null },
          { data: [{ eventId: 1000 }], error: null },
        ],
      }),
    );

    const { getEventDetail } = await importQueries();
    await getEventDetail('2');

    // ⚠️ resetModules + 動的 import のため、queries.ts と同じレジストリから取る
    const sentry = (await import('@sentry/nextjs')) as unknown as {
      captureMessage: jest.Mock;
    };
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        fingerprint: ['related-events-candidate-cap'],
      }),
    );
    warn.mockRestore();
  });

  it('returns no related events when the event has no titles', async () => {
    // 作品が無ければ引く条件が無い。DB へ投げずに空を返す。
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        events: { data: EVENT_ROW, error: null },
        event_titles: { data: [], error: null },
        occurrence_view: { data: [], error: null },
      }),
    );

    const { getEventDetail } = await importQueries();
    const result = await getEventDetail('2');
    expect(result?.relatedEvents).toEqual([]);
  });

  it('deduplicates an event that shares multiple titles', async () => {
    mockHasCredentials.mockReturnValue(true);
    mockCreatePublicClient.mockReturnValue(
      makeClient({
        events: { data: EVENT_ROW, error: null },
        event_titles: [
          {
            data: [
              { titles: { slug: 'w1', name: 'W1' } },
              { titles: { slug: 'w2', name: 'W2' } },
            ],
            error: null,
          },
          {
            // 同じ企画が 2 作品ぶん重複して返る
            data: [
              { events: { id: 7, name: '関連企画' } },
              { events: { id: 7, name: '関連企画' } },
            ],
            error: null,
          },
        ],
        occurrence_view: [
          { data: [], error: null },
          { data: [{ eventId: 7 }], error: null },
        ],
      }),
    );

    const { getEventDetail } = await importQueries();
    const result = await getEventDetail('2');
    expect(result?.relatedEvents).toEqual([{ id: 7, name: '関連企画' }]);
  });
});
