import { describe, expect, it } from '@jest/globals';

import { escapeRegExp } from '@/lib/utils/escape-regexp';

describe('escapeRegExp', () => {
  it('正規表現の特殊文字をエスケープし、そのまま一致させる', () => {
    const text = 'a.b*c+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp('a.b')).test('axb')).toBe(false);
  });

  it('特殊文字の無い文字列は変えない', () => {
    expect(escapeRegExp('work-a-cafe')).toBe('work-a-cafe');
  });
});
