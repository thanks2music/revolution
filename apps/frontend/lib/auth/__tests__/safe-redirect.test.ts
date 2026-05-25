/**
 * Layer1: open-redirect サニタイザ (sanitizeNextPath) の純粋関数テスト。
 *
 * 攻撃 payload を確実に DEFAULT_SAFE_PATH (`/mypage`) に倒し、正当な内部パスは
 * search/hash を保持して通すことを網羅する。auth/callback・login/page・LoginForm・
 * middleware が共有するため、ここでガードの全パターンを 1 箇所で固定する。
 */

import { DEFAULT_SAFE_PATH, sanitizeNextPath } from '@/lib/auth/safe-redirect';

describe('sanitizeNextPath — falls back to /mypage for unsafe inputs', () => {
  const unsafe: Array<[string, string | null | undefined]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['protocol-relative //evil.com', '//evil.com'],
    ['triple-slash ///evil.com', '///evil.com'],
    ['backslash /\\evil.com', '/\\evil.com'],
    ['absolute http URL', 'http://evil.com'],
    ['absolute https URL', 'https://evil.com'],
    ['encoded backslash /%5Cevil', '/%5Cevil'],
    ['encoded double-slash /%2F%2Fevil.com', '/%2F%2Fevil.com'],
    ['encoded protocol-relative %2F%2Fevil.com', '%2F%2Fevil.com'],
    ['does not start with slash', 'mypage'],
    ['scheme-relative without slash', 'evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['CRLF injection /foo%0d%0aSet-Cookie', '/foo%0d%0aSet-Cookie'],
    ['mid-path double slash /a//evil.com', '/a//evil.com'],
  ];

  it.each(unsafe)('rejects %s', (_label, input) => {
    expect(sanitizeNextPath(input)).toBe(DEFAULT_SAFE_PATH);
  });

  it('exposes /mypage as the default safe path', () => {
    expect(DEFAULT_SAFE_PATH).toBe('/mypage');
  });
});

describe('sanitizeNextPath — preserves legitimate internal paths', () => {
  it('allows a simple internal path', () => {
    expect(sanitizeNextPath('/mypage')).toBe('/mypage');
  });

  it('allows an internal path with a query string', () => {
    expect(sanitizeNextPath('/mypage?x=1')).toBe('/mypage?x=1');
  });

  it('allows a nested internal path with query', () => {
    expect(sanitizeNextPath('/collabo-cafe/work-a/slug?ref=1')).toBe(
      '/collabo-cafe/work-a/slug?ref=1',
    );
  });

  it('allows a hash fragment on an internal path', () => {
    expect(sanitizeNextPath('/mypage#section')).toBe('/mypage#section');
  });

  it('allows a percent-encoded query value that decodes to a safe internal path', () => {
    // middleware が url.searchParams.set('next', '/mypage?x=1') した値を Next.js が
    // decode して渡すラウンドトリップ。decode 後も内部パス形なら通す。
    expect(sanitizeNextPath('/mypage?x=1')).toBe('/mypage?x=1');
  });
});
