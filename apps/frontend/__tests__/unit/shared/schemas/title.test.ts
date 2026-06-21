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

  it('accepts every TITLE_KIND_VALUES literal (回帰検知)', () => {
    for (const kind of TITLE_KIND_VALUES) {
      expect(() =>
        TitleInsertSchema.parse({
          slug: 'jujutsu-kaisen',
          name: '呪術廻戦',
          kind,
        }),
      ).not.toThrow();
    }
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

  it('rejects slug with leading hyphen', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: '-foo', name: 'x', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects slug with trailing hyphen', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: 'foo-', name: 'x', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects slug with consecutive hyphens', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: 'foo--bar', name: 'x', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects slug consisting only of hyphens', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: '---', name: 'x', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      TitleInsertSchema.parse({ slug: 'jujutsu-kaisen', name: '', kind: 'manga' }),
    ).toThrow();
  });

  it('rejects whitespace-only name', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '   ',
        kind: 'manga',
      }),
    ).toThrow();
  });

  it('rejects empty string name_kana (use null for "no reading")', () => {
    expect(() =>
      TitleInsertSchema.parse({
        slug: 'jujutsu-kaisen',
        name: '呪術廻戦',
        nameKana: '',
        kind: 'manga',
      }),
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
 * 代表的な valid slug の fixture (regex 通過例として 5 値、kind の網羅性確認用)。
 *
 * 本テーブルには初期 seed を投入しない (handoff §3.C 採用案: AI Writer が逐次
 * 追加する設計)。fixture は Layer 1 regex/enum の代表例として保持。
 */
const VALID_TITLE_FIXTURES = [
  { slug: 'jujutsu-kaisen', kind: 'manga' },
  { slug: 'spy-family', kind: 'manga' },
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
    expect(TITLE_SLUG_REGEX.test('-foo')).toBe(false); // 先頭ハイフン
    expect(TITLE_SLUG_REGEX.test('foo-')).toBe(false); // 末尾ハイフン
    expect(TITLE_SLUG_REGEX.test('foo--bar')).toBe(false); // 連続ハイフン
    expect(TITLE_SLUG_REGEX.test('---')).toBe(false); // ハイフンのみ
    expect(TITLE_SLUG_REGEX.test('-')).toBe(false); // 単一ハイフン
  });

  it('全 fixture slug が regex を通過する (代表例 sanity check)', () => {
    expect(VALID_TITLE_FIXTURES).toHaveLength(5);
    for (const { slug } of VALID_TITLE_FIXTURES) {
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

  it('全 fixture kind が allowed list 内 (代表例 sanity check)', () => {
    for (const { kind } of VALID_TITLE_FIXTURES) {
      expect(TITLE_KIND_VALUES).toContain(kind);
    }
  });
});
