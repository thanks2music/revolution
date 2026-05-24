/**
 * Layer2: いいね Server Action (toggleFavorite / getFavorites) の Supabase mock contract
 *
 *   - user_id は getUser() から取得 (クライアント入力にしない = RLS と二重防御)
 *   - target_type は 'article' 固定
 *   - 既いいね → delete (解除, liked:false) / 未いいね → insert (追加, liked:true)
 *   - insert の 23505 (複合 PK 違反) は「既にいいね済み」として liked:true で冪等終了
 *   - 未認証は needsAuth で返す (記事は読めるが、いいねにはログインが要る)
 *   - getFavorites は本人の行を created_at 降順で返す
 *
 * jest.mock factory はホイストされ外部変数参照不可のため factory 内で完結させる。
 * Supabase の query builder はメソッドチェーン (.select().eq().eq().maybeSingle() 等)
 * のため、チェーン可能なスタブを 1 つ用意し、終端値をテストごとに差し込む。
 */

const TEST_UID = '550e8400-e29b-41d4-a716-446655440000';
const KEY = 'collabo-cafe/work-a/article-1';

jest.mock('@/lib/env', () => ({ env: {} }));

jest.mock('@/lib/supabase/server', () => {
  // チェーン可能な query ビルダー。select/eq/order 等は自身を返し、終端解決値は
  // builder.__result (Promise) として await される。maybeSingle も同値を返す。
  // 自己参照の型推論エラーを避けるため any で生成 (テスト用 mock のため許容)。
  const builder: any = {
    __result: { data: null, error: null },
    then: (resolve: (v: unknown) => unknown) => resolve(builder.__result),
  };
  builder.select = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.delete = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() => Promise.resolve(builder.__result));
  const from = jest.fn(() => builder);
  const auth = { getUser: jest.fn() };
  return {
    __mocks: { builder, from, auth },
    createClient: jest.fn(async () => ({ auth, from })),
  };
});

import { getFavorites, toggleFavorite } from '@/actions/favorite';

const { __mocks: m } = jest.requireMock('@/lib/supabase/server') as {
  __mocks: {
    builder: {
      __result: { data: unknown; error: unknown };
      select: jest.Mock;
      insert: jest.Mock;
      delete: jest.Mock;
      eq: jest.Mock;
      order: jest.Mock;
      maybeSingle: jest.Mock;
    };
    from: jest.Mock;
    auth: { getUser: jest.Mock };
  };
};

function setResult(result: { data?: unknown; error?: unknown }) {
  m.builder.__result = { data: result.data ?? null, error: result.error ?? null };
}

beforeEach(() => {
  jest.clearAllMocks();
  m.builder.select.mockReturnValue(m.builder);
  m.builder.insert.mockReturnValue(m.builder);
  m.builder.delete.mockReturnValue(m.builder);
  m.builder.eq.mockReturnValue(m.builder);
  m.builder.order.mockReturnValue(m.builder);
  m.builder.maybeSingle.mockImplementation(() => Promise.resolve(m.builder.__result));
  m.from.mockReturnValue(m.builder);
  m.auth.getUser.mockResolvedValue({ data: { user: { id: TEST_UID } }, error: null });
  setResult({ data: null, error: null });
});

describe('toggleFavorite — auth + user_id source', () => {
  it('returns needsAuth when there is no authenticated user', async () => {
    m.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await toggleFavorite(KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsAuth).toBe(true);
    expect(m.from).not.toHaveBeenCalled();
  });

  it('rejects an empty target key without touching the DB', async () => {
    const result = await toggleFavorite('');
    expect(result.ok).toBe(false);
    expect(m.auth.getUser).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('toggleFavorite — add (not yet liked)', () => {
  it('inserts using user_id from getUser and target_type=article, returns liked:true', async () => {
    // select.maybeSingle → null (未いいね) → insert
    setResult({ data: null, error: null });
    const result = await toggleFavorite(KEY);

    expect(result).toEqual({ ok: true, liked: true });
    expect(m.auth.getUser).toHaveBeenCalledTimes(1);
    expect(m.from).toHaveBeenCalledWith('favorites');
    expect(m.builder.insert).toHaveBeenCalledWith({
      user_id: TEST_UID,
      target_type: 'article',
      target_key: KEY,
    });
  });

  it('treats a 23505 on insert as already-liked (idempotent), liked:true', async () => {
    // select → null, insert → 23505
    let call = 0;
    m.builder.maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    m.builder.insert.mockImplementation(() => {
      call += 1;
      return {
        ...m.builder,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { code: '23505', message: 'duplicate' } }),
      };
    });
    const result = await toggleFavorite(KEY);
    expect(result).toEqual({ ok: true, liked: true });
    expect(call).toBe(1);
  });
});

describe('toggleFavorite — remove (already liked)', () => {
  it('deletes the existing row and returns liked:false', async () => {
    // select.maybeSingle → 既存行あり
    m.builder.maybeSingle.mockImplementation(() =>
      Promise.resolve({ data: { target_key: KEY }, error: null }),
    );
    // delete のチェーン終端は __result (error: null)
    setResult({ data: null, error: null });
    const result = await toggleFavorite(KEY);

    expect(result).toEqual({ ok: true, liked: false });
    expect(m.builder.delete).toHaveBeenCalledTimes(1);
    expect(m.builder.insert).not.toHaveBeenCalled();
  });
});

describe('getFavorites', () => {
  it('returns needsAuth when unauthenticated', async () => {
    m.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await getFavorites();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsAuth).toBe(true);
  });

  it('maps rows to FavoriteItem[] ordered by created_at desc', async () => {
    setResult({
      data: [
        { target_key: 'collabo-cafe/work-a/a1', created_at: '2026-01-02T00:00:00Z' },
        { target_key: 'articles/legacy-1', created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    });
    const result = await getFavorites();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.favorites).toEqual([
        { targetKey: 'collabo-cafe/work-a/a1', createdAt: '2026-01-02T00:00:00Z' },
        { targetKey: 'articles/legacy-1', createdAt: '2026-01-01T00:00:00Z' },
      ]);
    }
    expect(m.builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
