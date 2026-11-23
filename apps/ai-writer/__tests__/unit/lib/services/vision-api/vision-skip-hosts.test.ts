import { describe, expect, it } from '@jest/globals';

import { skipsVision } from '@/lib/services/vision-api/vision-skip-hosts';

describe('skipsVision', () => {
  const HOSTS = ['www.example-cafe.com'];

  it('公式サイトのホストが一覧にあれば true (www. の有無と大文字・小文字は区別しない)', () => {
    expect(skipsVision('https://www.example-cafe.com/event/cafe/a.html', HOSTS)).toBe(true);
    expect(skipsVision('https://EXAMPLE-cafe.com/event/', HOSTS)).toBe(true);
  });

  it('一覧に無いホスト・別のサブドメインは false', () => {
    expect(skipsVision('https://other.example.com/', HOSTS)).toBe(false);
    expect(skipsVision('https://shop.example-cafe.com/', HOSTS)).toBe(false);
  });

  it('URL が無い・読めない・一覧が無い時は false (Vision を呼ぶ)', () => {
    expect(skipsVision(null, HOSTS)).toBe(false);
    expect(skipsVision('not a url', HOSTS)).toBe(false);
    expect(skipsVision('https://www.example-cafe.com/', undefined)).toBe(false);
    // YAML の書き損じ (配列でない) でも記事の生成を止めない
    expect(skipsVision('https://www.example-cafe.com/', 'www.example-cafe.com')).toBe(false);
  });
});
