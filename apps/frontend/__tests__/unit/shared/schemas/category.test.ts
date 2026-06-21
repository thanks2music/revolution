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

  it('rejects slug with leading hyphen', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: '-foo', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug with trailing hyphen', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'foo-', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug with consecutive hyphens', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'foo--bar', name: 'x' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'collabo-cafe', name: '' }),
    ).toThrow();
  });

  it('rejects whitespace-only name', () => {
    expect(() =>
      CategoryInsertSchema.parse({ slug: 'collabo-cafe', name: '   ' }),
    ).toThrow();
  });
});

/**
 * Seed 全 23 件の slug 真実源リスト (migration 20260621040633_categories.sql と
 * revolution-templates/ai-writer/config/event-type-slugs.yaml 由来)。
 * regex / seed の整合性回帰検知用。新規 slug 追加時はここにも追加すること。
 */
const ALL_SEED_SLUGS = [
  'collabo-cafe',
  'pop-up-store',
  'only-shop',
  'exhibition',
  'exhibition-hall',
  'karaoke',
  'escape-game',
  'mystery-solving',
  'experience',
  'store-collabo',
  'game-collabo',
  'apps-collabo',
  'online',
  'streaming',
  'fashion',
  'stay',
  'theme-park',
  'hot-spring',
  'travel',
  'transportation',
  'campaign',
  'stamp-rally',
  'other-collabo',
] as const;

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
    expect(CATEGORY_SLUG_REGEX.test('-foo')).toBe(false); // 先頭ハイフン
    expect(CATEGORY_SLUG_REGEX.test('foo-')).toBe(false); // 末尾ハイフン
    expect(CATEGORY_SLUG_REGEX.test('foo--bar')).toBe(false); // 連続ハイフン
    expect(CATEGORY_SLUG_REGEX.test('---')).toBe(false); // ハイフンのみ
  });

  it('全 23 件の seed slug が regex を通過する (回帰検知)', () => {
    expect(ALL_SEED_SLUGS).toHaveLength(23);
    for (const slug of ALL_SEED_SLUGS) {
      expect(CATEGORY_SLUG_REGEX.test(slug)).toBe(true);
    }
  });
});
