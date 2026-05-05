/**
 * Unit tests for Slug Resolver Module (Layer 1: pure function)
 *
 * @description
 * YAML config is mocked with test fixtures to isolate Layer 1 logic from
 * production YAML data. This ensures tests are deterministic and don't break
 * when production YAML evolves.
 *
 * @module __tests__/unit/lib/config/slug-resolver
 */

// Mock slug-generator to control AI/ASCII fallback chain in Layer 2 contract tests
jest.mock('../../../../lib/config/slug-generator', () => {
  const actual = jest.requireActual('../../../../lib/config/slug-generator');
  return {
    ...actual,
    generateSlugWithFallback: jest.fn(),
  };
});

// Mock yaml-loader with test fixtures (jest.mock is hoisted automatically by babel-plugin-jest-hoist)
jest.mock('../../../../lib/config/yaml-loader', () => {
  const actual = jest.requireActual('../../../../lib/config/yaml-loader');
  return {
    ...actual,
    loadYamlConfig: jest.fn((key: string) => {
      switch (key) {
        case 'TITLE_ROMAJI':
          return {
            titles: {
              '作品名A': 'work-a',
              '作品名B': { slug: 'work-b', aliases: ['作品B別名'] },
              '作品名C': 'work-c',
            },
          };
        case 'BRAND_SLUGS':
          return {
            brand_slugs: {
              'アベイル': 'avail',
              'しまむら': 'shimamura',
              'セブン-イレブン': 'seven-eleven',
              'ドンキホーテ': 'donki',
              'ドン・キホーテ': 'donki',
            },
          };
        case 'EVENT_TYPE_SLUGS':
          return {
            event_types: {
              'コラボカフェ': 'collabo-cafe',
              'カフェコラボ': 'collabo-cafe',
              'スペシャルカフェ': 'collabo-cafe',
              'ポップアップストア': 'pop-up-store',
              'アベイルコラボ': 'store-collabo',
              'しまむらコラボ': 'store-collabo',
              'セブン-イレブンコラボ': 'store-collabo',
            },
          };
        case 'JP_PREFECTURE':
          return {
            prefectures: {
              '東京都': 'tokyo',
              '東京': 'tokyo',
              '都': 'tokyo',
              '大阪府': 'osaka',
              '福岡県': 'fukuoka',
              '北海道': 'hokkaido',
              '道': 'hokkaido',
            },
            major_cities: {
              '新宿': 'shinjuku',
              '渋谷': 'shibuya',
              '池袋': 'ikebukuro',
            },
          };
        default:
          return actual.loadYamlConfig(key);
      }
    }),
  };
});

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  resolveWorkSlug,
  resolveStoreSlug,
  resolveEventTypeSlug,
  resolvePrefectureSlug,
  resolveCitySlug,
  getAllWorkTitles,
  getAllBrandNames,
  getAllEventTypeNames,
  getAllPrefectureNames,
  isValidWorkTitle,
  isValidBrandName,
  isValidEventTypeName,
  clearConfigCache,
} from '../../../../lib/config';
import { generateSlugWithFallback } from '../../../../lib/config/slug-generator';

const mockGenerateSlugWithFallback = generateSlugWithFallback as jest.MockedFunction<
  typeof generateSlugWithFallback
>;

describe('resolveWorkSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve Japanese title to romaji slug', async () => {
    expect(await resolveWorkSlug('作品名A')).toBe('work-a');
    expect(await resolveWorkSlug('作品名B')).toBe('work-b');
    expect(await resolveWorkSlug('作品名C')).toBe('work-c');
  });

  it('should return null for unknown title (fallback disabled)', async () => {
    expect(await resolveWorkSlug('Unknown Title 未知の作品', false)).toBeNull();
  });

  it('should handle exact match only (case sensitive)', async () => {
    expect(await resolveWorkSlug('作品名A')).toBe('work-a');
    expect(await resolveWorkSlug('作品名a', false)).toBeNull(); // Different casing
  });
});

describe('resolveStoreSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve brand name to slug', async () => {
    expect(await resolveStoreSlug('アベイル')).toBe('avail');
    expect(await resolveStoreSlug('しまむら')).toBe('shimamura');
    expect(await resolveStoreSlug('セブン-イレブン')).toBe('seven-eleven');
  });

  it('should handle variant names (e.g., ドンキホーテ vs ドン・キホーテ)', async () => {
    expect(await resolveStoreSlug('ドンキホーテ')).toBe('donki');
    expect(await resolveStoreSlug('ドン・キホーテ')).toBe('donki');
  });

  it('should return null for unknown brand (fallback disabled)', async () => {
    expect(await resolveStoreSlug('Unknown Store', false)).toBeNull();
  });
});

describe('resolveEventTypeSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve event type to slug', async () => {
    expect(await resolveEventTypeSlug('コラボカフェ')).toBe('collabo-cafe');
    expect(await resolveEventTypeSlug('ポップアップストア')).toBe('pop-up-store');
  });

  it('should handle synonyms mapping to same slug', async () => {
    // Both should map to "collabo-cafe"
    expect(await resolveEventTypeSlug('コラボカフェ')).toBe('collabo-cafe');
    expect(await resolveEventTypeSlug('カフェコラボ')).toBe('collabo-cafe');
    expect(await resolveEventTypeSlug('スペシャルカフェ')).toBe('collabo-cafe');
  });

  it('should handle store-collabo synonyms', async () => {
    expect(await resolveEventTypeSlug('アベイルコラボ')).toBe('store-collabo');
    expect(await resolveEventTypeSlug('しまむらコラボ')).toBe('store-collabo');
    expect(await resolveEventTypeSlug('セブン-イレブンコラボ')).toBe('store-collabo');
  });

  it('should return null for unknown event type (fallback disabled)', async () => {
    expect(await resolveEventTypeSlug('Unknown Event Type', false)).toBeNull();
  });
});

describe('resolvePrefectureSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve prefecture name to slug', () => {
    expect(resolvePrefectureSlug('東京都')).toBe('tokyo');
    expect(resolvePrefectureSlug('大阪府')).toBe('osaka');
    expect(resolvePrefectureSlug('福岡県')).toBe('fukuoka');
  });

  it('should handle prefecture name variants', () => {
    // All should map to "tokyo"
    expect(resolvePrefectureSlug('東京都')).toBe('tokyo');
    expect(resolvePrefectureSlug('東京')).toBe('tokyo');
    expect(resolvePrefectureSlug('都')).toBe('tokyo');
  });

  it('should handle abbreviations', () => {
    expect(resolvePrefectureSlug('道')).toBe('hokkaido'); // 北海道 abbreviation
  });

  it('should return null for unknown prefecture', () => {
    expect(resolvePrefectureSlug('Unknown Prefecture')).toBeNull();
  });
});

describe('resolveCitySlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve major city names to slugs', () => {
    expect(resolveCitySlug('新宿')).toBe('shinjuku');
    expect(resolveCitySlug('渋谷')).toBe('shibuya');
    expect(resolveCitySlug('池袋')).toBe('ikebukuro');
  });

  it('should return null for unknown city', () => {
    expect(resolveCitySlug('Unknown City')).toBeNull();
  });
});

describe('getAllWorkTitles', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return array of all work titles', () => {
    const titles = getAllWorkTitles();

    expect(Array.isArray(titles)).toBe(true);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).toContain('作品名A');
    expect(titles).toContain('作品名B');
  });

  it('should return consistent results on multiple calls', () => {
    const titles1 = getAllWorkTitles();
    const titles2 = getAllWorkTitles();

    expect(titles1).toEqual(titles2);
  });
});

describe('getAllBrandNames', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return array of all brand names', () => {
    const brands = getAllBrandNames();

    expect(Array.isArray(brands)).toBe(true);
    expect(brands.length).toBeGreaterThan(0);
    expect(brands).toContain('アベイル');
    expect(brands).toContain('しまむら');
  });
});

describe('getAllEventTypeNames', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return array of all event type names including synonyms', () => {
    const types = getAllEventTypeNames();

    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain('コラボカフェ');
    expect(types).toContain('カフェコラボ'); // Synonym
  });
});

describe('getAllPrefectureNames', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return array of all prefecture names including variants', () => {
    const prefectures = getAllPrefectureNames();

    expect(Array.isArray(prefectures)).toBe(true);
    expect(prefectures.length).toBeGreaterThan(0);
    expect(prefectures).toContain('東京都');
    expect(prefectures).toContain('東京'); // Variant
    expect(prefectures).toContain('都'); // Abbreviation
  });
});

describe('isValidWorkTitle', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return true for valid titles', () => {
    expect(isValidWorkTitle('作品名A')).toBe(true);
    expect(isValidWorkTitle('作品名B')).toBe(true);
  });

  it('should return false for invalid titles', () => {
    expect(isValidWorkTitle('Unknown Title')).toBe(false);
    expect(isValidWorkTitle('')).toBe(false);
  });
});

describe('isValidBrandName', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return true for valid brand names', () => {
    expect(isValidBrandName('アベイル')).toBe(true);
    expect(isValidBrandName('しまむら')).toBe(true);
  });

  it('should return false for invalid brand names', () => {
    expect(isValidBrandName('Unknown Brand')).toBe(false);
  });
});

describe('isValidEventTypeName', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should return true for valid event type names', () => {
    expect(isValidEventTypeName('コラボカフェ')).toBe(true);
    expect(isValidEventTypeName('カフェコラボ')).toBe(true); // Synonym
  });

  it('should return false for invalid event type names', () => {
    expect(isValidEventTypeName('Unknown Event')).toBe(false);
  });
});

describe('Integration: Canonical Key Generation', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should generate canonical key components correctly', async () => {
    const workSlug = await resolveWorkSlug('作品名A');
    const storeSlug = await resolveStoreSlug('アベイル');
    const eventType = await resolveEventTypeSlug('コラボカフェ');
    const year = 2025;

    expect(workSlug).toBe('work-a');
    expect(storeSlug).toBe('avail');
    expect(eventType).toBe('collabo-cafe');

    const canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;
    expect(canonicalKey).toBe('work-a:avail:collabo-cafe:2025');
  });

  it('should handle synonym event types in canonical key', async () => {
    const workSlug = await resolveWorkSlug('作品名A');
    const storeSlug = await resolveStoreSlug('しまむら');
    const eventType1 = await resolveEventTypeSlug('コラボカフェ');
    const eventType2 = await resolveEventTypeSlug('カフェコラボ'); // Synonym
    const year = 2025;

    const key1 = `${workSlug}:${storeSlug}:${eventType1}:${year}`;
    const key2 = `${workSlug}:${storeSlug}:${eventType2}:${year}`;

    // Both synonyms should produce the same canonical key
    expect(key1).toBe(key2);
    expect(key1).toBe('work-a:shimamura:collabo-cafe:2025');
  });
});

describe('Caching behavior', () => {
  it('should use cache on subsequent calls', async () => {
    clearConfigCache();

    // First call loads from file
    const slug1 = await resolveWorkSlug('作品名A');

    // Second call should use cache
    const slug2 = await resolveWorkSlug('作品名A');

    expect(slug1).toBe(slug2);
    expect(slug1).toBe('work-a');
  });

  it('should reload after cache clear', async () => {
    const slug1 = await resolveWorkSlug('作品名A');

    clearConfigCache('TITLE_ROMAJI');

    const slug2 = await resolveWorkSlug('作品名A');

    expect(slug1).toBe(slug2);
    expect(slug1).toBe('work-a');
  });
});

describe('resolveWorkSlug with AI fallback (Layer 2 contract)', () => {
  beforeEach(() => {
    clearConfigCache();
    mockGenerateSlugWithFallback.mockReset();
  });

  it('should return AI-generated slug for unknown title with fallback enabled', async () => {
    mockGenerateSlugWithFallback.mockResolvedValueOnce('unknown-fallback-slug');

    const result = await resolveWorkSlug('完全に未知の新作', true);

    expect(result).toBe('unknown-fallback-slug');
    expect(mockGenerateSlugWithFallback).toHaveBeenCalledWith(
      '完全に未知の新作',
      'anime/manga title',
      undefined
    );
  });

  it('should return null when AI fallback throws (caught and propagated as null)', async () => {
    mockGenerateSlugWithFallback.mockRejectedValueOnce(
      new Error('API quota exceeded')
    );

    const result = await resolveWorkSlug('完全に未知の新作', true);

    expect(result).toBeNull();
  });
});
