import { describe, expect, it } from '@jest/globals';

import {
  VENUE_SLUG_REGEX,
  VenueInsertSchema,
} from '@revolution/schemas/venue';

describe('VenueInsertSchema', () => {
  it('accepts valid slug + name (minimal)', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
      }),
    ).not.toThrow();
  });

  it('accepts optional prefecture + city + address', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        prefecture: '東京都',
        city: '千代田区',
        address: '丸の内一丁目',
      }),
    ).not.toThrow();
  });

  it('accepts null prefecture / city / address', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        prefecture: null,
        city: null,
        address: null,
      }),
    ).not.toThrow();
  });

  it('accepts geo as WKT string', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        geo: 'POINT(139.7670 35.6812)',
      }),
    ).not.toThrow();
  });

  it('rejects slug with uppercase', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'Tokyo-Station', name: '東京駅' }),
    ).toThrow();
  });

  it('rejects slug with japanese chars', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: '東京', name: '東京駅' }),
    ).toThrow();
  });

  it('rejects slug with leading hyphen', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: '-foo', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug with trailing hyphen', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'foo-', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug with consecutive hyphens', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'foo--bar', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug consisting only of hyphens', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: '---', name: 'x' }),
    ).toThrow();
  });

  it('rejects slug with underscore', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'foo_bar', name: 'x' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'tokyo-station', name: '' }),
    ).toThrow();
  });

  it('rejects whitespace-only name', () => {
    expect(() =>
      VenueInsertSchema.parse({ slug: 'tokyo-station', name: '   ' }),
    ).toThrow();
  });

  it('rejects empty string prefecture (use null for "unknown")', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        prefecture: '',
      }),
    ).toThrow();
  });

  it('rejects empty string city (use null for "unknown")', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        city: '',
      }),
    ).toThrow();
  });

  it('rejects empty string address (use null for "unknown")', () => {
    expect(() =>
      VenueInsertSchema.parse({
        slug: 'tokyo-station',
        name: '東京駅',
        address: '',
      }),
    ).toThrow();
  });
});

/**
 * 代表的な valid slug の fixture (regex 通過例として 5 値)。
 *
 * 本テーブルには初期 seed を投入しない (handoff §3.D 採用案: AI Writer が逐次
 * 追加する設計、Phase 2-a 継承)。fixture は Layer 1 regex の代表例として保持。
 */
const VALID_VENUE_FIXTURES = [
  { slug: 'tokyo-station', name: '東京駅' },
  { slug: 'osaka-station', name: '大阪駅' },
  { slug: 'nanjatown', name: 'ナンジャタウン' },
  { slug: 'shibuya-parco', name: '渋谷パルコ' },
  { slug: 'pokemon-center-mega-tokyo', name: 'ポケモンセンターメガトウキョー' },
] as const;

describe('VENUE_SLUG_REGEX', () => {
  it('matches valid slugs (代表例)', () => {
    expect(VENUE_SLUG_REGEX.test('tokyo-station')).toBe(true);
    expect(VENUE_SLUG_REGEX.test('osaka-station')).toBe(true);
    expect(VENUE_SLUG_REGEX.test('nanjatown')).toBe(true);
    expect(VENUE_SLUG_REGEX.test('shibuya-parco')).toBe(true);
    expect(VENUE_SLUG_REGEX.test('pokemon-center-mega-tokyo')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(VENUE_SLUG_REGEX.test('Tokyo-Station')).toBe(false); // 大文字
    expect(VENUE_SLUG_REGEX.test('東京駅')).toBe(false); // 日本語
    expect(VENUE_SLUG_REGEX.test('slug with space')).toBe(false); // スペース
    expect(VENUE_SLUG_REGEX.test('')).toBe(false); // 空文字
    expect(VENUE_SLUG_REGEX.test('slug_underscore')).toBe(false); // アンダースコア
    expect(VENUE_SLUG_REGEX.test('-foo')).toBe(false); // 先頭ハイフン
    expect(VENUE_SLUG_REGEX.test('foo-')).toBe(false); // 末尾ハイフン
    expect(VENUE_SLUG_REGEX.test('foo--bar')).toBe(false); // 連続ハイフン
    expect(VENUE_SLUG_REGEX.test('---')).toBe(false); // ハイフンのみ
    expect(VENUE_SLUG_REGEX.test('-')).toBe(false); // 単一ハイフン
  });

  it('全 fixture slug が regex を通過する (代表例 sanity check)', () => {
    expect(VALID_VENUE_FIXTURES).toHaveLength(5);
    for (const { slug } of VALID_VENUE_FIXTURES) {
      expect(VENUE_SLUG_REGEX.test(slug)).toBe(true);
    }
  });
});
