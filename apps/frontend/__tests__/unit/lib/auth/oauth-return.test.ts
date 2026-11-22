import { oauthReturnCookie } from '@/lib/auth/oauth-return';

describe('Google ログインの戻り先の cookie', () => {
  it('callback だけに送る、短い寿命の cookie にする。https では Secure を付ける', () => {
    expect(oauthReturnCookie('/review?q=100%25', true)).toBe(
      'oauth_next=%2Freview%3Fq%3D100%2525; Path=/auth/callback; Max-Age=600; SameSite=Lax; Secure'
    );
    expect(oauthReturnCookie('/mypage', false)).not.toContain('Secure');
  });
});
