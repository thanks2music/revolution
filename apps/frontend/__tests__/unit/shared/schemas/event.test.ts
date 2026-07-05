import { describe, expect, it } from '@jest/globals';

import { EVENT_SLUG_REGEX, EventInsertSchema } from '@revolution/schemas/event';

describe('EventInsertSchema', () => {
  it('accepts valid slug + name + primary_category_id (minimal)', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-5-oh-my-cafe',
        name: 'トイ・ストーリー 5 OH MY CAFE',
        primaryCategoryId: 1,
      }),
    ).not.toThrow();
  });

  it('accepts optional description + official_url', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-5-oh-my-cafe',
        name: 'トイ・ストーリー 5 OH MY CAFE',
        primaryCategoryId: 1,
        description: 'ディズニー・ピクサー映画とのコラボカフェ',
        officialUrl: 'https://example.com/toy-story-5-cafe',
      }),
    ).not.toThrow();
  });

  it('accepts null description + official_url', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-5-oh-my-cafe',
        name: 'トイ・ストーリー 5 OH MY CAFE',
        primaryCategoryId: 1,
        description: null,
        officialUrl: null,
      }),
    ).not.toThrow();
  });

  it('rejects slug with uppercase', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'Toy-Story-Cafe',
        name: 'x',
        primaryCategoryId: 1,
      }),
    ).toThrow();
  });

  it('rejects slug with japanese chars', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'トイストーリー',
        name: 'x',
        primaryCategoryId: 1,
      }),
    ).toThrow();
  });

  it('rejects slug with leading hyphen', () => {
    expect(() =>
      EventInsertSchema.parse({ slug: '-foo', name: 'x', primaryCategoryId: 1 }),
    ).toThrow();
  });

  it('rejects slug with trailing hyphen', () => {
    expect(() =>
      EventInsertSchema.parse({ slug: 'foo-', name: 'x', primaryCategoryId: 1 }),
    ).toThrow();
  });

  it('rejects slug with consecutive hyphens', () => {
    expect(() =>
      EventInsertSchema.parse({ slug: 'foo--bar', name: 'x', primaryCategoryId: 1 }),
    ).toThrow();
  });

  it('rejects slug consisting only of hyphens', () => {
    expect(() =>
      EventInsertSchema.parse({ slug: '---', name: 'x', primaryCategoryId: 1 }),
    ).toThrow();
  });

  it('rejects slug with underscore', () => {
    expect(() =>
      EventInsertSchema.parse({ slug: 'foo_bar', name: 'x', primaryCategoryId: 1 }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: '',
        primaryCategoryId: 1,
      }),
    ).toThrow();
  });

  it('rejects whitespace-only name (ASCII)', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: '   ',
        primaryCategoryId: 1,
      }),
    ).toThrow();
  });

  it('rejects official_url that is not a valid URL', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: 'x',
        primaryCategoryId: 1,
        officialUrl: 'not-a-url',
      }),
    ).toThrow();
  });

  it('accepts official_url with query and fragment', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: 'x',
        primaryCategoryId: 1,
        officialUrl: 'https://example.com/path?utm=source#anchor',
      }),
    ).not.toThrow();
  });
});

/**
 * Sprint B 固有シナリオ: primary_category_id URL 正準一意性
 *
 * `events.primary_category_id` は URL 正準セグメント (例: `/collabo-cafe`) を
 * 決める **必ず 1 つ、必須** の主分類。event-review-data-model.md §6「主分類 +
 * 補助タグ」設計。
 */
describe('primary_category_id URL 正準一意性', () => {
  it('requires primary_category_id (NOT NULL)', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: 'x',
      }),
    ).toThrow();
  });

  it('accepts primary_category_id as bigint number', () => {
    expect(() =>
      EventInsertSchema.parse({
        slug: 'toy-story-cafe',
        name: 'x',
        primaryCategoryId: 42,
      }),
    ).not.toThrow();
  });
});

/**
 * 代表的な valid slug の fixture (regex 通過例として 5 値)。
 *
 * 本テーブルには初期 seed を投入しない (Sprint B handoff §3.6: AI Writer が
 * 逐次追加する設計、Phase 2-a/2-b 継承)。fixture は Layer 1 regex の代表例。
 */
const VALID_EVENT_FIXTURES = [
  { slug: 'toy-story-5-oh-my-cafe', name: 'トイ・ストーリー 5 OH MY CAFE' },
  { slug: 'jujutsu-kaisen-collabo-cafe', name: '呪術廻戦コラボカフェ' },
  { slug: 'demon-slayer-pop-up-store', name: '鬼滅の刃ポップアップストア' },
  { slug: 'chiikawa-nagano-exhibition', name: 'ちいかわ長野原画展' },
  { slug: 'pokemon-cafe-tokyo-2026', name: 'ポケモンカフェ東京 2026' },
] as const;

describe('EVENT_SLUG_REGEX', () => {
  it('matches valid slugs (代表例)', () => {
    expect(EVENT_SLUG_REGEX.test('toy-story-5-oh-my-cafe')).toBe(true);
    expect(EVENT_SLUG_REGEX.test('jujutsu-kaisen-collabo-cafe')).toBe(true);
    expect(EVENT_SLUG_REGEX.test('demon-slayer-pop-up-store')).toBe(true);
    expect(EVENT_SLUG_REGEX.test('chiikawa-nagano-exhibition')).toBe(true);
    expect(EVENT_SLUG_REGEX.test('pokemon-cafe-tokyo-2026')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(EVENT_SLUG_REGEX.test('Toy-Story-Cafe')).toBe(false); // 大文字
    expect(EVENT_SLUG_REGEX.test('トイストーリー')).toBe(false); // 日本語
    expect(EVENT_SLUG_REGEX.test('slug with space')).toBe(false); // スペース
    expect(EVENT_SLUG_REGEX.test('')).toBe(false); // 空文字
    expect(EVENT_SLUG_REGEX.test('slug_underscore')).toBe(false); // アンダースコア
    expect(EVENT_SLUG_REGEX.test('-foo')).toBe(false); // 先頭ハイフン
    expect(EVENT_SLUG_REGEX.test('foo-')).toBe(false); // 末尾ハイフン
    expect(EVENT_SLUG_REGEX.test('foo--bar')).toBe(false); // 連続ハイフン
    expect(EVENT_SLUG_REGEX.test('---')).toBe(false); // ハイフンのみ
    expect(EVENT_SLUG_REGEX.test('-')).toBe(false); // 単一ハイフン
  });

  it('全 fixture slug が regex を通過する (代表例 sanity check)', () => {
    expect(VALID_EVENT_FIXTURES).toHaveLength(5);
    for (const { slug } of VALID_EVENT_FIXTURES) {
      expect(EVENT_SLUG_REGEX.test(slug)).toBe(true);
    }
  });
});
