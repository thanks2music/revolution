/**
 * Layer2 境界: auth/callback Route Handler の契約テスト (security boundary)
 *
 * OAuth callback は exchangeCodeForSession でセッションを確立し、`next` の指す内部パスへ
 * リダイレクトする security boundary。回帰防止のため以下を固定する:
 *   - code 欠落 → /login?error=auth
 *   - exchangeCodeForSession 失敗 → /login?error=auth
 *   - 成功 + 正当な next → その内部パスへ
 *   - 成功 + 改ざん next (//evil.com 等) → sanitizeNextPath で /mypage に正規化 (open-redirect 防止)
 *   - 成功 + next 欠落 → 既定 /mypage
 *
 * jest の NODE_ENV は 'test' (≠ 'development') のため isLocalEnv=false。x-forwarded-host を
 * 付与しないので最終 else (origin 相対) を通る。createClient は mock し、sanitizeNextPath は
 * 実物 (純粋関数) をそのまま使う。
 */

const exchangeCodeForSession = jest.fn();

jest.mock('@/lib/env', () => ({ env: {} }));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from '@/app/auth/callback/route';

const ORIGIN = 'http://localhost:4444';

function callbackRequest(query: string): Request {
  return new Request(`${ORIGIN}/auth/callback${query}`);
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
});

describe('GET /auth/callback', () => {
  it('code 欠落時は /login?error=auth へリダイレクトし、交換も呼ばない', async () => {
    const res = await GET(callbackRequest('?next=/mypage'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchangeCodeForSession 失敗時は /login?error=auth へリダイレクト', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid grant' } });
    const res = await GET(callbackRequest('?code=bad&next=/mypage'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth`);
  });

  it('成功 + 正当な内部パス next はそのパスへリダイレクト', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest('?code=ok&next=/mypage'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/mypage`);
  });

  it('成功 + 改ざん next (//evil.com) は /mypage に正規化される (open-redirect 防止)', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest('?code=ok&next=//evil.com'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/mypage`);
  });

  it('成功 + next 欠落は既定 /mypage へ', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest('?code=ok'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/mypage`);
  });
});
