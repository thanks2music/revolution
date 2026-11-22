import { oauthReturnCookie, readOauthReturn } from '@/lib/auth/oauth-return';

describe('Google ログインの戻り先の cookie', () => {
  it('callback だけに送る、短い寿命の cookie にする。https では Secure を付ける', () => {
    expect(oauthReturnCookie('/review?q=100%25', true)).toBe(
      'oauth_next=%2Freview%3Fq%3D100%2525; Path=/auth/callback; Max-Age=600; SameSite=Lax; Secure'
    );
    expect(oauthReturnCookie('/mypage', false)).not.toContain('Secure');
  });

  it('書いた値をそのまま読み戻す。空や壊れた値は null', () => {
    const value = oauthReturnCookie('/review?q=A%26B', true).split(';')[0].split('=')[1];
    expect(readOauthReturn(value)).toBe('/review?q=A%26B');
    expect(readOauthReturn(undefined)).toBeNull();
    expect(readOauthReturn('%E0%A4%A')).toBeNull();
  });
});
