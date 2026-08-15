/**
 * Layer 2: Server Actions の Sentry 計装コントラクト。
 *
 * Server Actions は Result パターン (`{ ok: false }` を返す) で **throw しない**ため、
 * `instrumentation.ts` の `onRequestError` には一切乗らない。個別に captureException
 * しない限り永久に観測できない。
 *
 * ただし全部拾うと無料枠 (5K events/月) が即座に溶ける。判定は
 * 「**ユーザー入力に帰責するものは捨て、インフラ / DB に帰責するものだけ拾う**」。
 * **捨てる側もコントラクトとして固定する** — 「念のため拾う」への揺り戻しを防ぐため。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

const authUser = { id: 'user-1', identities: [{ provider: 'email' }] };

/** Supabase クライアントの最小ダブル。呼び出しごとに挙動を差し替える。 */
const authMock = {
  getUser: jest.fn(async () => ({ data: { user: authUser }, error: null })),
  updateUser: jest.fn(async () => ({ error: null })),
  signInWithOtp: jest.fn(async () => ({ error: null })),
  verifyOtp: jest.fn(async () => ({ error: null })),
  signOut: jest.fn(async () => ({ error: null })),
};

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({ auth: authMock })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendOtp, verifyOtp, signOut } = require('@/actions/auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { updateEmail, updatePassword } = require('@/actions/account');

beforeEach(() => {
  jest.clearAllMocks();
  authMock.getUser.mockResolvedValue({ data: { user: authUser }, error: null } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('拾う: インフラ / 認証基盤に帰責する失敗', () => {
  it('signInWithOtp の失敗は captureException する (メール基盤 / rate limit)', async () => {
    authMock.signInWithOtp.mockResolvedValueOnce({
      error: { message: 'rate limit exceeded' },
    } as never);

    const result = await sendOtp('user@example.com');

    expect(result.ok).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureException as jest.Mock).mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(options.tags.action).toBe('signInWithOtp');
  });

  it('signOut の失敗は captureException する', async () => {
    authMock.signOut.mockResolvedValueOnce({ error: { message: 'boom' } } as never);

    await signOut();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('updateEmail の失敗は captureException する', async () => {
    authMock.updateUser.mockResolvedValueOnce({ error: { message: 'smtp down' } } as never);

    const result = await updateEmail({ email: 'new@example.com' });

    expect(result.ok).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('updatePassword の失敗は captureException する', async () => {
    authMock.updateUser.mockResolvedValueOnce({ error: { message: 'weak password' } } as never);

    await updatePassword({ password: 'longenoughpassword' });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('捨てる: ユーザー入力に帰責する失敗', () => {
  // 本 PR で最も枠を溶かしやすい経路。回帰させない。
  it('verifyOtp の失敗は captureException しない (コードの打ち間違い / 期限切れ)', async () => {
    authMock.verifyOtp.mockResolvedValueOnce({ error: { message: 'invalid otp' } } as never);

    const result = await verifyOtp('user@example.com', '123456');

    expect(result.ok).toBe(false);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('zod バリデーション失敗は captureException しない (sendOtp)', async () => {
    const result = await sendOtp('not-an-email');

    expect(result.ok).toBe(false);
    expect(authMock.signInWithOtp).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('未ログインは captureException しない (正常系の一部)', async () => {
    authMock.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as never);

    const result = await updatePassword({ password: 'longenoughpassword' });

    expect(result.ok).toBe(false);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
