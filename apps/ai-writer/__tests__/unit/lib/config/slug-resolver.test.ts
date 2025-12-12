/**
 * Unit tests for Slug Resolver Module
 *
 * @module __tests__/unit/lib/config/slug-resolver
 */

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

describe('resolveWorkSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve Japanese title to romaji slug', () => {
    expect(resolveWorkSlug('呪術廻戦')).toBe('jujutsu-kaisen');
    expect(resolveWorkSlug('SPY×FAMILY')).toBe('spy-family');
    expect(resolveWorkSlug('鬼滅の刃')).toBe('kimetsu-no-yaiba');
  });

  it('should return null for unknown title', () => {
    expect(resolveWorkSlug('Unknown Title 未知の作品')).toBeNull();
  });

  it('should handle exact match only (case sensitive)', () => {
    expect(resolveWorkSlug('呪術廻戦')).toBe('jujutsu-kaisen');
    expect(resolveWorkSlug('呪術回戦')).toBeNull(); // Different kanji
  });
});

describe('resolveStoreSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve brand name to slug', () => {
    expect(resolveStoreSlug('アベイル')).toBe('avail');
    expect(resolveStoreSlug('しまむら')).toBe('shimamura');
    expect(resolveStoreSlug('セブン-イレブン')).toBe('seven-eleven');
  });

  it('should handle variant names (e.g., ドンキホーテ vs ドン・キホーテ)', () => {
    expect(resolveStoreSlug('ドンキホーテ')).toBe('donki');
    expect(resolveStoreSlug('ドン・キホーテ')).toBe('donki');
  });

  it('should return null for unknown brand', () => {
    expect(resolveStoreSlug('Unknown Store')).toBeNull();
  });
});

describe('resolveEventTypeSlug', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should resolve event type to slug', () => {
    expect(resolveEventTypeSlug('コラボカフェ')).toBe('collabo-cafe');
    expect(resolveEventTypeSlug('ポップアップストア')).toBe('pop-up-store');
  });

  it('should handle synonyms mapping to same slug', () => {
    // Both should map to "collabo-cafe"
    expect(resolveEventTypeSlug('コラボカフェ')).toBe('collabo-cafe');
    expect(resolveEventTypeSlug('カフェコラボ')).toBe('collabo-cafe');
    expect(resolveEventTypeSlug('スペシャルカフェ')).toBe('collabo-cafe');
  });

  it('should handle store-collabo synonyms', () => {
    expect(resolveEventTypeSlug('アベイルコラボ')).toBe('store-collabo');
    expect(resolveEventTypeSlug('しまむらコラボ')).toBe('store-collabo');
    expect(resolveEventTypeSlug('セブン-イレブンコラボ')).toBe('store-collabo');
  });

  it('should return null for unknown event type', () => {
    expect(resolveEventTypeSlug('Unknown Event Type')).toBeNull();
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
    expect(titles).toContain('呪術廻戦');
    expect(titles).toContain('SPY×FAMILY');
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
    expect(isValidWorkTitle('呪術廻戦')).toBe(true);
    expect(isValidWorkTitle('SPY×FAMILY')).toBe(true);
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

  it('should generate canonical key components correctly', () => {
    const workSlug = resolveWorkSlug('呪術廻戦');
    const storeSlug = resolveStoreSlug('アベイル');
    const eventType = resolveEventTypeSlug('コラボカフェ');
    const year = 2025;

    expect(workSlug).toBe('jujutsu-kaisen');
    expect(storeSlug).toBe('avail');
    expect(eventType).toBe('collabo-cafe');

    const canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;
    expect(canonicalKey).toBe('jujutsu-kaisen:avail:collabo-cafe:2025');
  });

  it('should handle synonym event types in canonical key', () => {
    const workSlug = resolveWorkSlug('呪術廻戦');
    const storeSlug = resolveStoreSlug('しまむら');
    const eventType1 = resolveEventTypeSlug('コラボカフェ');
    const eventType2 = resolveEventTypeSlug('カフェコラボ'); // Synonym
    const year = 2025;

    const key1 = `${workSlug}:${storeSlug}:${eventType1}:${year}`;
    const key2 = `${workSlug}:${storeSlug}:${eventType2}:${year}`;

    // Both synonyms should produce the same canonical key
    expect(key1).toBe(key2);
    expect(key1).toBe('jujutsu-kaisen:shimamura:collabo-cafe:2025');
  });
});

describe('Caching behavior', () => {
  it('should use cache on subsequent calls', () => {
    clearConfigCache();

    // First call loads from file
    const slug1 = resolveWorkSlug('呪術廻戦');

    // Second call should use cache
    const slug2 = resolveWorkSlug('呪術廻戦');

    expect(slug1).toBe(slug2);
    expect(slug1).toBe('jujutsu-kaisen');
  });

  it('should reload after cache clear', () => {
    const slug1 = resolveWorkSlug('呪術廻戦');

    clearConfigCache('TITLE_ROMAJI');

    const slug2 = resolveWorkSlug('呪術廻戦');

    expect(slug1).toBe(slug2);
    expect(slug1).toBe('jujutsu-kaisen');
  });
});
