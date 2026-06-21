import { describe, expect, it } from '@jest/globals';

import {
  TITLE_KIND_VALUES,
  TITLE_SLUG_REGEX,
  TitleInsertSchema,
} from '@revolution/schemas/title';

describe('TitleInsertSchema', () => {
  it('accepts valid slug + name + kind', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '呪術廻戦',
        kind: 'manga',
      }),
    ).not.toThrow();
  });

  it('accepts optional name_kana', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '呪術廻戦',
        nameKana: 'じゅじゅつかいせん',
        kind: 'manga',
      }),
    ).not.toThrow();
  });

  it('accepts null name_kana', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '呪術廻戦',
        nameKana: null,
        kind: 'manga',
      }),
    ).not.toThrow();
  });

  it('rejects slug with uppercase', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'Jujutsu-Kaisen',
        name: '呪術廻戦',
        kind: 'manga',
      }),
    ).toThrow();
  });

  it('rejects slug with japanese chars', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: '呪術', name: '呪術廻戦', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: 'jujutsu-kaisen', name: '', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects invalid kind', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '呪術廻戦',
        kind: 'movie',
      }),
    ).toThrow();
  });
});

/**
 * Seed 全 8 件の真実源リスト (migration 20260621101241_titles.sql 由来)。
 * regex / kind / seed の整合性回帰検知用。新規 seed 追加時はここにも追加すること。
 */
const ALL_SEED_TITLES = [
  { slug: 'jujutsu-kaisen', kind: 'manga' },
  { slug: 'spy-family', kind: 'manga' },
  { slug: 'frieren', kind: 'manga' },
  { slug: 'tougen-anki', kind: 'manga' },
  { slug: 'chiikawa', kind: 'manga' },
  { slug: 'pokemon', kind: 'game' },
  { slug: 'genshin-impact', kind: 'game' },
  { slug: 'sanrio-characters', kind: 'other' },
] as const;

describe('TITLE_SLUG_REGEX', () => {
  it('matches valid slugs (代表例)', () => {
    expect(TITLE_SLUG_REGEX.test('jujutsu-kaisen')).toBe(true);
    expect(TITLE_SLUG_REGEX.test('spy-family')).toBe(true);
    expect(TITLE_SLUG_REGEX.test('frieren')).toBe(true);
    expect(TITLE_SLUG_REGEX.test('pokemon')).toBe(true);
    expect(TITLE_SLUG_REGEX.test('genshin-impact')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(TITLE_SLUG_REGEX.test('Jujutsu-Kaisen')).toBe(false); // 大文字
    expect(TITLE_SLUG_REGEX.test('呪術廻戦')).toBe(false); // 日本語
    expect(TITLE_SLUG_REGEX.test('slug with space')).toBe(false); // スペース
    expect(TITLE_SLUG_REGEX.test('')).toBe(false); // 空文字
    expect(TITLE_SLUG_REGEX.test('slug_underscore')).toBe(false); // アンダースコア
  });

  it('全 8 件の seed slug が regex を通過する (回帰検知)', () => {
    expect(ALL_SEED_TITLES).toHaveLength(8);
    for (const { slug } of ALL_SEED_TITLES) {
      expect(TITLE_SLUG_REGEX.test(slug)).toBe(true);
    }
  });
});

describe('TITLE_KIND_VALUES', () => {
  it('contains exactly 5 allowed kinds (DB CHECK と二段防御)', () => {
    expect(TITLE_KIND_VALUES).toEqual([
      'anime',
      'manga',
      'game',
      'novel',
      'other',
    ]);
  });

  it('全 8 件の seed kind が allowed list 内 (回帰検知)', () => {
    for (const { kind } of ALL_SEED_TITLES) {
      expect(TITLE_KIND_VALUES).toContain(kind);
    }
  });
});
