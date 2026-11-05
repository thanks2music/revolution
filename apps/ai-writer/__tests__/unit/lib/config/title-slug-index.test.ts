/**
 * 辞書だけを引く関数 (Layer 1): findDictionaryWorkSlug / resolveCanonicalTitleSlug / getSlugAliases
 *
 * fixture を mock する (実辞書は gitignored な同期コピーで CI に無い。short-title-prefix.test.ts と同じ方式)。
 * 値は架空の作品にしてある。
 */

import { describe, expect, it } from '@jest/globals';

jest.mock('../../../../lib/config/slug-generator', () => ({
  generateSlugWithFallback: jest.fn(),
}));

jest.mock('../../../../lib/config/yaml-loader', () => {
  const actual = jest.requireActual('../../../../lib/config/yaml-loader');
  // 手書きの辞書
  const titles = {
    '作品A': { slug: 'work-a', aliases: ['作品A別名', 'sakuhin-a', 'old-work-a'] },
    '作品B': 'work-b',
    '作品C': { slug: 'work-c', aliases: ['shared-romaji'] },
    '作品D': { slug: 'work-d', aliases: ['shared-romaji', 'work-a'] },
  };
  // 自動生成の辞書 (手書きと同じキーは手書きが勝つ)
  const generated = {
    '作品A': { slug: 'generated-a' },
    '作品E': { slug: 'work-e', aliases: ['作品E別名', 'sakuhin-e'] },
    '作品F': { slug: 'work-f', aliases: ['作品A別名'] },
  };
  return {
    mergeTitleMappings: actual.mergeTitleMappings,
    loadGeneratedTitleMapping: jest.fn(() => ({ titles: generated })),
    loadYamlConfig: jest.fn((key: string) => {
      if (key === 'TITLE_ROMAJI') return { titles };
      throw new Error(`unexpected config key: ${key}`);
    }),
  };
});

import { findDictionaryWorkSlug, getSlugAliases, resolveCanonicalTitleSlug } from '@/lib/config/slug-resolver';

describe('findDictionaryWorkSlug', () => {
  it('作品名と別名の完全一致で辞書の slug を返す', () => {
    expect(findDictionaryWorkSlug('作品A')).toBe('work-a');
    expect(findDictionaryWorkSlug('作品A別名')).toBe('work-a');
    expect(findDictionaryWorkSlug('作品B')).toBe('work-b');
  });

  it('辞書に無ければ null (AI で slug を作らない)', () => {
    expect(findDictionaryWorkSlug('辞書に無い作品')).toBeNull();
  });

  it('自動生成の辞書も引く。キーと別名が重なれば手書きが勝つ', () => {
    expect(findDictionaryWorkSlug('作品E')).toBe('work-e');
    expect(findDictionaryWorkSlug('作品E別名')).toBe('work-e');
    expect(findDictionaryWorkSlug('作品A')).toBe('work-a');
    expect(findDictionaryWorkSlug('作品A別名')).toBe('work-a');
  });
});

describe('resolveCanonicalTitleSlug', () => {
  it('辞書の slug はそのまま返す', () => {
    expect(resolveCanonicalTitleSlug('work-a')).toBe('work-a');
    expect(resolveCanonicalTitleSlug('work-b')).toBe('work-b');
  });

  it('slug の形の別名は、その作品の slug にする (自動生成の作品も)', () => {
    expect(resolveCanonicalTitleSlug('sakuhin-a')).toBe('work-a');
    expect(resolveCanonicalTitleSlug('old-work-a')).toBe('work-a');
    expect(resolveCanonicalTitleSlug('sakuhin-e')).toBe('work-e');
  });

  it('2 つの作品が持つ別名と、辞書に無い slug は null', () => {
    expect(resolveCanonicalTitleSlug('shared-romaji')).toBeNull();
    expect(resolveCanonicalTitleSlug('unknown-slug')).toBeNull();
  });

  it('ほかの作品の slug と同じ別名は、その slug のまま (別名で上書きしない)', () => {
    expect(resolveCanonicalTitleSlug('work-a')).toBe('work-a');
  });
});

describe('getSlugAliases', () => {
  it('slug の形の別名だけを返す (日本語の別名は返さない)', () => {
    expect(getSlugAliases('work-a')).toEqual(['sakuhin-a', 'old-work-a']);
    expect(getSlugAliases('work-b')).toEqual([]);
    expect(getSlugAliases('unknown-slug')).toEqual([]);
  });

  it('2 つの作品が持つ別名と、ほかの作品の slug と同じ別名は返さない (resolveCanonicalTitleSlug とそろえる)', () => {
    expect(getSlugAliases('work-c')).toEqual([]);
    expect(getSlugAliases('work-d')).toEqual([]);
  });
});
