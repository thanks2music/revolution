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

import { NextRequest } from 'next/server';

import { GET } from '@/app/auth/callback/route';

const ORIGIN = 'http://localhost:4444';

function callbackRequest(query: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}/auth/callback${query}`, { headers: cookie ? { cookie } : {} });
}

/** 戻り先の cookie を消す Set-Cookie が付いているか */
function clearsReturnCookie(res: Response): boolean {
  const header = res.headers.get('set-cookie') ?? '';
  return (
    /oauth_next=;/.test(header) &&
    /Path=\/auth\/callback/i.test(header) &&
    /Max-Age=0/i.test(header)
  );
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

describe('Google ログインの戻り先の cookie (one-more-time #166)', () => {
  beforeEach(() => exchangeCodeForSession.mockResolvedValue({ error: null }));

  it('URL に next が無ければ cookie から読み、使ったら消す', async () => {
    const res = await GET(callbackRequest('?code=ok', 'oauth_next=%2Freview%3Fq%3D100%2525'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/review?q=100%25`);
    expect(clearsReturnCookie(res)).toBe(true);
  });

  it('URL の next を cookie より優先する', async () => {
    const res = await GET(callbackRequest('?code=ok&next=/mypage', 'oauth_next=%2Freview'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/mypage`);
  });

  it('書き換えた cookie (外部の URL) は /mypage に正規化する', async () => {
    const res = await GET(callbackRequest('?code=ok', 'oauth_next=%2F%2Fevil.com'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/mypage`);
  });

  it('交換に失敗しても、コードが無くても cookie は消す', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid grant' } });
    expect(
      clearsReturnCookie(await GET(callbackRequest('?code=bad', 'oauth_next=%2Freview')))
    ).toBe(true);
    expect(clearsReturnCookie(await GET(callbackRequest('', 'oauth_next=%2Freview')))).toBe(true);
  });
});
