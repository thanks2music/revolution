/**
 * Layer 2: `favorites` テーブルを読む Server Action の Sentry 計装コントラクト。
 *
 * 同じテーブルを触る 3 関数のうち `toggleFavorite()` の select / delete / insert だけが
 * captureException しており、読み取り側が 2 回に分けて取り残された
 * (どちらも claude[bot] レビュー #316 の指摘):
 *
 * 1. `getFavorites()` — マイページのいいね一覧が丸ごと出ない状態が見えなかった
 * 2. `getFavoriteState()` — 記事ページで LikeButton がマウントするたびに走る経路。
 *    throw しても Server Action は `onRequestError` に乗らず、呼び出し元は `.catch` で
 *    ローカル表示に倒すだけなので、送らなければ Sentry には一切届かない
 *
 * 同じ見落としを 3 度繰り返さないよう、両方を契約として固定する。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

const user = { id: 'user-1' };

/**
 * チェーン末端で結果を返すダブル。2 つの呼び出し形に両対応する:
 * - `getFavorites`:     `.from().select().eq().eq().order().limit()`
 * - `getFavoriteState`: `.from().select().eq().eq().eq().maybeSingle()`
 */
function makeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.limit = jest.fn(async () => result);
  chain.maybeSingle = jest.fn(async () => result);
  return { from: jest.fn(() => chain) };
}

let supabase: ReturnType<typeof makeSupabase>;

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => supabase),
}));
jest.mock('@/lib/auth/current-user', () => ({
  getCachedUser: jest.fn(async () => ({ data: { user }, error: null })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getFavorites, getFavoriteState } = require('@/actions/favorite');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getFavorites の Sentry 計装', () => {
  it('DB エラーは captureException する', async () => {
    supabase = makeSupabase({ data: null, error: { message: 'connection refused' } });

    const result = await getFavorites();

    expect(result.ok).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureException as jest.Mock).mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(options.tags.action).toBe('getFavorites');
  });

  it('正常時は captureException しない', async () => {
    supabase = makeSupabase({ data: [{ target_key: 'k', created_at: '2026-01-01' }], error: null });

    const result = await getFavorites();

    expect(result.ok).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('getFavoriteState の Sentry 計装', () => {
  it('DB エラーは captureException してから throw する', async () => {
    supabase = makeSupabase({ data: null, error: { message: 'connection refused' } });

    await expect(getFavoriteState('article:abc')).rejects.toThrow('Failed to load favorite state');

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureException as jest.Mock).mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(options.tags.action).toBe('getFavoriteState');
  });

  it('正常時は captureException しない', async () => {
    supabase = makeSupabase({ data: { target_key: 'article:abc' }, error: null });

    await expect(getFavoriteState('article:abc')).resolves.toEqual({
      isAuthed: true,
      liked: true,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('未いいね (data: null / error なし) も captureException しない', async () => {
    supabase = makeSupabase({ data: null, error: null });

    await expect(getFavoriteState('article:abc')).resolves.toEqual({
      isAuthed: true,
      liked: false,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
