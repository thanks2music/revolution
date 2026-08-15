/**
 * Layer 2: `getFavorites()` の Sentry 計装コントラクト。
 *
 * 同じ `favorites` テーブルを触る `toggleFavorite()` の select / delete / insert は
 * captureException しているのに、`getFavorites()` だけ落としていた
 * (claude[bot] レビュー #316 の指摘)。Supabase の障害でマイページのいいね一覧が
 * 丸ごと出ない状態が Sentry から見えなくなるため、契約として固定する。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

const user = { id: 'user-1' };

/** `.from().select().eq().eq().order().limit()` のチェーン末端で結果を返すダブル。 */
function makeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.limit = jest.fn(async () => result);
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
const { getFavorites } = require('@/actions/favorite');

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
