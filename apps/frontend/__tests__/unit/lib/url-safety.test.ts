import { describe, expect, it } from '@jest/globals';

import { isSafeHttpUrl } from '@/lib/url-safety';

/**
 * `official_url` は **スクレイピング元 HTML から LLM が抽出した値**で、
 * zod (`z.string().url()`) も DB CHECK もスキームを制限していない
 * (2026-08-14 実測)。ここが最後の砦なので、危険なスキームを網羅して固定する。
 */
describe('isSafeHttpUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com',
    'HTTPS://EXAMPLE.COM',
    '  https://example.com  ',
    'https://example.com/path?q=1#frag',
  ])('allows http(s): %s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    // スキーム相対。ブラウザは現在のスキームを引き継ぐため、外部リンクとしては通さない。
    '//evil.com',
    '/relative/path',
    'example.com',
  ])('rejects %s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false);
  });

  it('rejects empty and nullish values', () => {
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });

  it('rejects a scheme that merely starts with the letters http', () => {
    // `httpsx://` や `httpevil:` を前方一致で誤って通さないこと。
    expect(isSafeHttpUrl('httpsx://example.com')).toBe(false);
    expect(isSafeHttpUrl('httpevil:alert(1)')).toBe(false);
  });
});
