/**
 * middleware の振り分け (one-more-time #166)。onboarding を挟んでも、来た画面 (?next=) へ戻す。
 */
import { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

jest.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key',
  },
}));

let claims: Record<string, unknown> | null = null;
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims } }) } }),
}));

const signedIn = (onboarded: boolean) => ({ sub: 'u1', user_metadata: { onboarded } });

async function go(path: string) {
  const response = await updateSession(new NextRequest(new URL(path, 'http://localhost:3000')));
  const location = response.headers.get('location');
  return location ? new URL(location).pathname + new URL(location).search : null;
}

describe('updateSession の振り分け', () => {
  it('未ログインで 7-0 を開くと、戻り先つきでログインへ', async () => {
    claims = null;
    await expect(go('/review')).resolves.toBe('/login?next=%2Freview');
  });

  it('onboarding の途中で保護された画面を開くと、戻り先つきで onboarding へ', async () => {
    claims = signedIn(false);
    await expect(go('/collabo-cafe/1/x/review')).resolves.toBe(
      '/onboarding?next=%2Fcollabo-cafe%2F1%2Fx%2Freview'
    );
  });

  it('ログインの後に onboarding の途中で /login に来たら、戻り先を onboarding へ持ち越す', async () => {
    claims = signedIn(false);
    await expect(go('/login?next=%2Freview')).resolves.toBe('/onboarding?next=%2Freview');
  });

  it('onboarding を済ませた会員が /onboarding・/login に来たら、戻り先 (無ければマイページ) へ', async () => {
    claims = signedIn(true);
    await expect(go('/onboarding?next=%2Freview%3Fq%3Dabc')).resolves.toBe('/review?q=abc');
    await expect(go('/login')).resolves.toBe('/mypage');
  });

  it('戻り先のクエリの % や & を、onboarding を挟んでも崩さない', async () => {
    claims = signedIn(false);
    const toOnboarding = await go('/review?q=100%25%26A');
    expect(toOnboarding).toBe('/onboarding?next=%2Freview%3Fq%3D100%2525%2526A');
    claims = signedIn(true);
    await expect(go(toOnboarding!)).resolves.toBe('/review?q=100%25%26A');
  });

  it('外部の URL を戻り先にしない', async () => {
    claims = signedIn(true);
    await expect(go('/onboarding?next=https%3A%2F%2Fevil.example')).resolves.toBe('/mypage');
  });
});
