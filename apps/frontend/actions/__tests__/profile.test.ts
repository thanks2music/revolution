/**
 * Layer2: profile (onboarding) Server Action の Supabase mock contract。
 *   - getUser() から user_id を取得 (クライアント入力にしない = RLS と二重防御)
 *   - profiles.update を本人 id (.eq('id', user.id)) で呼ぶ契約
 *   - 23505 (lower(username) unique 違反) を username フィールドエラーに変換
 *   - 成功時に updateUser({ data: { onboarded: true } }) で JWT claims を書く (案B)
 *   - zod (Layer1) で形式エラーを弾き Supabase を呼ばない
 *
 * jest.mock factory はホイストされ外部変数参照不可のため、factory 内で完結させ、
 * 各テストで mock モジュールからハンドルを取り出す。
 */

const TEST_UID = '550e8400-e29b-41d4-a716-446655440000';

// lib/env は @t3-oss/env-nextjs (ESM-only) を読むため mock 化する。
jest.mock('@/lib/env', () => ({ env: {} }));

jest.mock('@/lib/supabase/server', () => {
  // profiles.update(...).eq('id', uid).select('id') のチェーン。終端 select が
  // { data, error } を解決する (0 行ガードのため data に影響行を入れる)。
  const select = jest.fn();
  const eq = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ update }));
  const auth = {
    getUser: jest.fn(),
    updateUser: jest.fn(),
    refreshSession: jest.fn(),
  };
  return {
    __mocks: { select, eq, update, from, auth },
    createClient: jest.fn(async () => ({ auth, from })),
  };
});

import { completeOnboarding } from '@/actions/profile';

// `import * as` の namespace は SWC ESM interop が実 export 名のみ公開し __mocks を
// 剥がすため、requireMock で factory の生戻り値を取得する。
const { __mocks: m } = jest.requireMock('@/lib/supabase/server') as {
  __mocks: {
    select: jest.Mock;
    eq: jest.Mock;
    update: jest.Mock;
    from: jest.Mock;
    auth: { getUser: jest.Mock; updateUser: jest.Mock; refreshSession: jest.Mock };
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  // チェーンを再構築 (clearAllMocks は実装も消すため毎回 returnValue を設定)。
  // 既定は 1 行更新成功 (影響行 1 件)。
  m.select.mockResolvedValue({ data: [{ id: TEST_UID }], error: null } as never);
  m.eq.mockReturnValue({ select: m.select });
  m.update.mockReturnValue({ eq: m.eq });
  m.from.mockReturnValue({ update: m.update });
  m.auth.getUser.mockResolvedValue({
    data: { user: { id: TEST_UID } },
    error: null,
  } as never);
  m.auth.updateUser.mockResolvedValue({ data: {}, error: null } as never);
  m.auth.refreshSession.mockResolvedValue({ data: {}, error: null } as never);
});

describe('completeOnboarding — happy path', () => {
  it('updates profiles by own id and writes onboarded:true to claims (案B)', async () => {
    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: 'あにめ太郎',
    });

    expect(result).toEqual({ ok: true });

    // user_id は getUser 由来 (クライアント入力にしていない)
    expect(m.auth.getUser).toHaveBeenCalledTimes(1);
    expect(m.from).toHaveBeenCalledWith('profiles');
    expect(m.update).toHaveBeenCalledWith({
      username: 'anime_taro',
      display_name: 'あにめ太郎',
    });
    expect(m.eq).toHaveBeenCalledWith('id', TEST_UID);

    // 案B: 完了フラグを JWT claims に書く
    expect(m.auth.updateUser).toHaveBeenCalledWith({ data: { onboarded: true } });
    // updateUser は新 JWT を返さないため refreshSession で onboarded を JWT に反映する
    expect(m.auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('completeOnboarding — username uniqueness (23505)', () => {
  it('maps a 23505 unique violation to a username field error', async () => {
    m.select.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "profiles_username_lower_idx"',
      },
    } as never);

    const result = await completeOnboarding({
      username: 'TakenName',
      displayName: 'User',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('username');
      expect(result.error).toMatch(/使用されています/);
    }
    // 重複で失敗したので claims は書かない
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — validation (Layer1) short-circuits Supabase', () => {
  it('rejects invalid username format without touching the DB', async () => {
    const result = await completeOnboarding({
      username: 'bad name',
      displayName: 'User',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('username');
    expect(m.auth.getUser).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects empty displayName without touching the DB', async () => {
    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('displayName');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — auth guard', () => {
  it('returns an error when there is no authenticated user', async () => {
    m.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as never);

    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: 'User',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('general');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — generic DB error', () => {
  it('maps non-23505 errors to a general error and does not write claims', async () => {
    m.select.mockResolvedValue({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    } as never);

    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: 'User',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('general');
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — 0-row update guard (#2)', () => {
  it('does not write onboarded:true when the profiles update affects 0 rows', async () => {
    // PostgREST は 0 行 update でも error=null を返す。data が空配列なら成功扱いにしない。
    m.select.mockResolvedValue({ data: [], error: null } as never);

    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: 'User',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('general');
    // profiles 書き込みが起きていないため onboarded:true を立てない (整合性防御)。
    expect(m.auth.updateUser).not.toHaveBeenCalled();
    expect(m.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('treats a null data (no rows) as failure as well', async () => {
    m.select.mockResolvedValue({ data: null, error: null } as never);
    const result = await completeOnboarding({
      username: 'anime_taro',
      displayName: 'User',
    });
    expect(result.ok).toBe(false);
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });
});
