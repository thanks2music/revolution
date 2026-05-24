/**
 * Layer2: auth Server Actions の Supabase mock contract。
 * verifyOtp / signInWithOtp の「呼び出し引数の契約」+ エラー時の型付き結果を検証する。
 * 実 Supabase に依存せず、createClient を mock して契約のみ assert する。
 *
 * 注: jest.mock の factory は import より前にホイストされるため、factory 内で
 * out-of-scope の変数を参照できない (Jest の制約)。よって factory 内で jest.fn を
 * 生成し、各テストで createClient の戻り値から auth メソッドを取り出して assert する。
 */

// lib/env は @t3-oss/env-nextjs (ESM-only) を読むため mock 化する。
jest.mock('@/lib/env', () => ({ env: {} }));

// createClient を mock 化 (server クライアント)。factory はホイストされるため
// 内部で完結させる (外部変数参照禁止)。
jest.mock('@/lib/supabase/server', () => {
  const auth = {
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    signOut: jest.fn(),
  };
  return {
    __auth: auth,
    createClient: jest.fn(async () => ({ auth })),
  };
});

import { sendOtp, verifyOtp, signOut } from '@/actions/auth';

// mock モジュールから auth メソッド束を取り出す。
// 注: `import * as` の namespace は SWC ESM interop が「実モジュールに存在する
// export 名」(= createClient) のみ公開し __auth を剥がすため、requireMock で
// factory の生戻り値を取得する。
const { __auth: auth } = jest.requireMock('@/lib/supabase/server') as {
  __auth: {
    signInWithOtp: jest.Mock;
    verifyOtp: jest.Mock;
    signOut: jest.Mock;
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendOtp', () => {
  it('calls signInWithOtp with shouldCreateUser:true for new email (contract)', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null } as never);

    const result = await sendOtp('newuser@example.com');

    expect(result).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'newuser@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('rejects invalid email without calling supabase', async () => {
    const result = await sendOtp('not-an-email');
    expect(result.ok).toBe(false);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('returns a user-facing error when supabase fails', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: 'rate limited' },
    } as never);

    const result = await sendOtp('user@example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/送信/);
  });
});

describe('verifyOtp', () => {
  it('calls verifyOtp with type:"email" and 6-digit token (contract)', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null } as never);

    const result = await verifyOtp('user@example.com', '123456');

    expect(result).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('rejects a non 6-digit token without calling supabase', async () => {
    const result = await verifyOtp('user@example.com', '12ab');
    expect(result.ok).toBe(false);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('returns a user-facing error on wrong/expired code', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: { message: 'Token has expired or is invalid' },
    } as never);

    const result = await verifyOtp('user@example.com', '000000');
    expect(result.ok).toBe(false);
  });
});

describe('signOut', () => {
  it('returns ok on success', async () => {
    auth.signOut.mockResolvedValue({ error: null } as never);
    const result = await signOut();
    expect(result).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
