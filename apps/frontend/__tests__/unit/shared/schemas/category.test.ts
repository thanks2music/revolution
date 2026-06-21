import { describe, expect, it } from '@jest/globals';

import {
  CATEGORY_SLUG_REGEX,
  CategoryInsertSchema,
} from '@revolution/schemas/category';

describe('CategoryInsertSchema', () => {
  it('accepts valid slug + name', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'collabo-cafe', name: 'コラボカフェ' }),
    ).not.toThrow();
  });

  it('rejects slug with uppercase', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'Collabo-Cafe', name: 'foo' }),
    ).toThrow();
  });

  it('rejects slug with japanese chars', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'コラボ', name: 'foo' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'collabo-cafe', name: '' }),
    ).toThrow();
  });
});

describe('CATEGORY_SLUG_REGEX', () => {
  it('matches valid slugs (handoff doc 23 件のうち代表)', () => {
    expect(CATEGORY_SLUG_REGEX.test('collabo-cafe')).toBe(true);
    expect(CATEGORY_SLUG_REGEX.test('pop-up-store')).toBe(true);
    expect(CATEGORY_SLUG_REGEX.test('exhibition')).toBe(true);
    expect(CATEGORY_SLUG_REGEX.test('only-shop')).toBe(true);
    expect(CATEGORY_SLUG_REGEX.test('other-collabo')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(CATEGORY_SLUG_REGEX.test('Collabo-Cafe')).toBe(false); // 大文字
    expect(CATEGORY_SLUG_REGEX.test('コラボ')).toBe(false); // 日本語
    expect(CATEGORY_SLUG_REGEX.test('slug with space')).toBe(false); // スペース
    expect(CATEGORY_SLUG_REGEX.test('')).toBe(false); // 空文字
    expect(CATEGORY_SLUG_REGEX.test('slug_underscore')).toBe(false); // アンダースコア
  });
});
