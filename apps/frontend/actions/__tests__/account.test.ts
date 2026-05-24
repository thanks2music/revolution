/**
 * Layer2: アカウント管理 Server Action の Supabase mock contract
 *
 *   - updateUsername: profiles.update を本人 id で呼ぶ / 23505 → username エラー
 *   - updateDisplayName: profiles.update を本人 id で呼ぶ
 *   - updateEmail: メール登録ユーザーのみ可 (Google 不可、サーバ側 provider 再確認) /
 *     updateUser({ email }) を呼ぶ
 *   - updatePassword: updateUser({ password }) を呼ぶ
 *   - zod (Layer1) で形式エラーを弾き Supabase を呼ばない
 *
 * profiles.update のチェーンは profile.test.ts と同じ from→update→eq。
 */

const TEST_UID = '550e8400-e29b-41d4-a716-446655440000';

jest.mock('@/lib/env', () => ({ env: {} }));

jest.mock('@/lib/supabase/server', () => {
  const eq = jest.fn();
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ update }));
  const auth = {
    getUser: jest.fn(),
    updateUser: jest.fn(),
  };
  return {
    __mocks: { eq, update, from, auth },
    createClient: jest.fn(async () => ({ auth, from })),
  };
});

import {
  updateDisplayName,
  updateEmail,
  updatePassword,
  updateUsername,
} from '@/actions/account';

const { __mocks: m } = jest.requireMock('@/lib/supabase/server') as {
  __mocks: {
    eq: jest.Mock;
    update: jest.Mock;
    from: jest.Mock;
    auth: { getUser: jest.Mock; updateUser: jest.Mock };
  };
};

function setUserIdentities(identities: { provider: string }[], email = 'old@example.com') {
  m.auth.getUser.mockResolvedValue({
    data: { user: { id: TEST_UID, email, identities } },
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  m.eq.mockResolvedValue({ error: null });
  m.update.mockReturnValue({ eq: m.eq });
  m.from.mockReturnValue({ update: m.update });
  m.auth.updateUser.mockResolvedValue({ data: {}, error: null });
  setUserIdentities([{ provider: 'email' }]);
});

describe('updateUsername', () => {
  it('updates profiles by own id', async () => {
    const result = await updateUsername({ username: 'new_name' });
    expect(result.ok).toBe(true);
    expect(m.from).toHaveBeenCalledWith('profiles');
    expect(m.update).toHaveBeenCalledWith({ username: 'new_name' });
    expect(m.eq).toHaveBeenCalledWith('id', TEST_UID);
  });

  it('maps 23505 to a username field error', async () => {
    m.eq.mockResolvedValue({ error: { code: '23505', message: 'dup' } });
    const result = await updateUsername({ username: 'TakenName' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('username');
      expect(result.error).toMatch(/使用されています/);
    }
  });

  it('rejects invalid format without touching the DB', async () => {
    const result = await updateUsername({ username: 'bad name' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('username');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('updateDisplayName', () => {
  it('updates display_name by own id', async () => {
    const result = await updateDisplayName({ displayName: 'あにめ花子' });
    expect(result.ok).toBe(true);
    expect(m.update).toHaveBeenCalledWith({ display_name: 'あにめ花子' });
    expect(m.eq).toHaveBeenCalledWith('id', TEST_UID);
  });

  it('rejects empty display name', async () => {
    const result = await updateDisplayName({ displayName: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('displayName');
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe('updateEmail — provider gating', () => {
  it('allows email change for an email-registered user (calls updateUser)', async () => {
    setUserIdentities([{ provider: 'email' }]);
    const result = await updateEmail({ email: 'new@example.com' });
    expect(result.ok).toBe(true);
    expect(m.auth.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  it('forbids email change for a google-only user (server-side guard, no updateUser)', async () => {
    setUserIdentities([{ provider: 'google' }]);
    const result = await updateEmail({ email: 'new@example.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('email');
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid email without touching auth', async () => {
    const result = await updateEmail({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('email');
    expect(m.auth.getUser).not.toHaveBeenCalled();
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('updatePassword', () => {
  it('sets the password via updateUser', async () => {
    const result = await updatePassword({ password: 'sup3r-secret' });
    expect(result.ok).toBe(true);
    expect(m.auth.updateUser).toHaveBeenCalledWith({ password: 'sup3r-secret' });
  });

  it('rejects a too-short password without touching auth', async () => {
    const result = await updatePassword({ password: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('password');
    expect(m.auth.updateUser).not.toHaveBeenCalled();
  });
});
