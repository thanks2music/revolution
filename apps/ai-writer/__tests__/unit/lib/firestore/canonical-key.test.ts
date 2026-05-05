/**
 * Unit tests for Canonical Key Generator
 *
 * @module __tests__/unit/lib/firestore/canonical-key
 */

// Hermetic fixtures: keep tests independent of production YAML content.
// `apps/ai-writer/templates/` is gitignored and synced from a private repo,
// so depending on it would make the suite fail in clean checkouts.
jest.mock('../../../../lib/config/yaml-loader', () => {
  const actual = jest.requireActual('../../../../lib/config/yaml-loader');
  return {
    ...actual,
    loadYamlConfig: jest.fn((key: string) => {
      switch (key) {
        case 'TITLE_ROMAJI':
          return {
            titles: {
              '呪術廻戦': { slug: 'jujutsu-kaisen' },
              'SPY×FAMILY': { slug: 'spy-family' },
            },
          };
        case 'BRAND_SLUGS':
          return {
            brand_slugs: {
              'アベイル': 'avail',
              'しまむら': 'shimamura',
            },
          };
        case 'EVENT_TYPE_SLUGS':
          return {
            event_types: {
              'コラボカフェ': 'collabo-cafe',
              'カフェコラボ': 'collabo-cafe',
              'しまむらコラボ': 'store-collabo',
            },
          };
        default:
          return actual.loadYamlConfig(key);
      }
    }),
  };
});

// Resolver functions are wrapped so individual tests can override per-call
// behavior (e.g. force null to exercise the throw path).
jest.mock('../../../../lib/config', () => {
  const actual = jest.requireActual<typeof import('../../../../lib/config')>(
    '../../../../lib/config'
  );
  return {
    ...actual,
    resolveWorkSlug: jest.fn(actual.resolveWorkSlug),
    resolveStoreSlug: jest.fn(actual.resolveStoreSlug),
    resolveEventTypeSlug: jest.fn(actual.resolveEventTypeSlug),
  };
});

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  generateCanonicalKey,
  generateCanonicalKeyFromNames,
  parseCanonicalKey,
  isValidCanonicalKey,
} from '../../../../lib/firestore/canonical-key';
import {
  clearConfigCache,
  resolveWorkSlug,
  resolveStoreSlug,
  resolveEventTypeSlug,
} from '../../../../lib/config';
import type { CanonicalKeyComponents } from '../../../../lib/firestore/types';

const mockResolveWorkSlug = resolveWorkSlug as jest.MockedFunction<typeof resolveWorkSlug>;
const mockResolveStoreSlug = resolveStoreSlug as jest.MockedFunction<typeof resolveStoreSlug>;
const mockResolveEventTypeSlug = resolveEventTypeSlug as jest.MockedFunction<typeof resolveEventTypeSlug>;

describe('generateCanonicalKey', () => {
  it('should generate canonical key from components', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    };

    const key = generateCanonicalKey(components);
    expect(key).toBe('jujutsu-kaisen:avail:collabo-cafe:2025');
  });

  it('should throw error for empty workSlug', () => {
    const components: CanonicalKeyComponents = {
      workSlug: '',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow(
      'All slug components'
    );
  });

  it('should throw error for empty storeSlug', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu-kaisen',
      storeSlug: '',
      eventType: 'collabo-cafe',
      year: 2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow(
      'All slug components'
    );
  });

  it('should throw error for empty eventType', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: '',
      year: 2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow(
      'All slug components'
    );
  });

  it('should throw error for invalid year (non-integer)', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025.5,
    };

    expect(() => generateCanonicalKey(components)).toThrow('Invalid year');
  });

  it('should throw error for invalid year (negative)', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: -2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow('Invalid year');
  });

  it('should throw error for invalid workSlug format (uppercase)', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'Jujutsu-Kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow(
      'Invalid workSlug format'
    );
  });

  it('should throw error for invalid slug format (special chars)', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'jujutsu_kaisen', // underscore not allowed
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    };

    expect(() => generateCanonicalKey(components)).toThrow(
      'Invalid workSlug format'
    );
  });

  it('should handle different event types correctly', () => {
    const components: CanonicalKeyComponents = {
      workSlug: 'spy-family',
      storeSlug: 'shimamura',
      eventType: 'store-collabo',
      year: 2024,
    };

    const key = generateCanonicalKey(components);
    expect(key).toBe('spy-family:shimamura:store-collabo:2024');
  });
});

describe('generateCanonicalKeyFromNames', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should generate canonical key from Japanese names', async () => {
    const result = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    expect(result.canonicalKey).toBe('jujutsu-kaisen:avail:collabo-cafe:2025');
    expect(result.components).toEqual({
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    });
  });

  it('should handle synonym event types', async () => {
    // Both "コラボカフェ" and "カフェコラボ" should map to "collabo-cafe"
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'カフェコラボ',
      2025
    );

    expect(result1.canonicalKey).toBe(result2.canonicalKey);
  });

  it('should throw error for unknown work title', async () => {
    mockResolveWorkSlug.mockResolvedValueOnce(null);
    await expect(
      generateCanonicalKeyFromNames(
        'Unknown Work 未知の作品',
        'アベイル',
        'コラボカフェ',
        2025
      )
    ).rejects.toThrow(/^Failed to resolve work slug for title: "[^"]+"/);
  });

  it('should throw error for unknown store name', async () => {
    mockResolveStoreSlug.mockResolvedValueOnce(null);
    await expect(
      generateCanonicalKeyFromNames(
        '呪術廻戦',
        'Unknown Store',
        'コラボカフェ',
        2025
      )
    ).rejects.toThrow(/^Failed to resolve store slug for brand: "[^"]+"/);
  });

  it('should throw error for unknown event type', async () => {
    mockResolveEventTypeSlug.mockResolvedValueOnce(null);
    await expect(
      generateCanonicalKeyFromNames(
        '呪術廻戦',
        'アベイル',
        'Unknown Event Type',
        2025
      )
    ).rejects.toThrow(/^Failed to resolve event type slug for: "[^"]+"/);
  });

  it('should handle different works and stores', async () => {
    const result = await generateCanonicalKeyFromNames(
      'SPY×FAMILY',
      'しまむら',
      'コラボカフェ',
      2024
    );

    expect(result.canonicalKey).toBe('spy-family:shimamura:collabo-cafe:2024');
  });

  it('should handle store-collabo event types', async () => {
    const result = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'しまむら',
      'しまむらコラボ',
      2025
    );

    expect(result.canonicalKey).toBe(
      'jujutsu-kaisen:shimamura:store-collabo:2025'
    );
  });
});

describe('parseCanonicalKey', () => {
  it('should parse valid canonical key', () => {
    const components = parseCanonicalKey(
      'jujutsu-kaisen:avail:collabo-cafe:2025'
    );

    expect(components).toEqual({
      workSlug: 'jujutsu-kaisen',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    });
  });

  it('should parse key with different components', () => {
    const components = parseCanonicalKey(
      'spy-family:shimamura:store-collabo:2024'
    );

    expect(components).toEqual({
      workSlug: 'spy-family',
      storeSlug: 'shimamura',
      eventType: 'store-collabo',
      year: 2024,
    });
  });

  it('should return null for invalid format (too few parts)', () => {
    const components = parseCanonicalKey('jujutsu-kaisen:avail:2025');
    expect(components).toBeNull();
  });

  it('should return null for invalid format (too many parts)', () => {
    const components = parseCanonicalKey(
      'jujutsu-kaisen:avail:collabo-cafe:2025:extra'
    );
    expect(components).toBeNull();
  });

  it('should return null for invalid year format', () => {
    const components = parseCanonicalKey(
      'jujutsu-kaisen:avail:collabo-cafe:invalid'
    );
    expect(components).toBeNull();
  });

  it('should return null for empty components', () => {
    const components = parseCanonicalKey('jujutsu-kaisen::collabo-cafe:2025');
    expect(components).toBeNull();
  });

  it('should handle round-trip generation and parsing', async () => {
    const { canonicalKey } = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const components = parseCanonicalKey(canonicalKey);

    expect(components).not.toBeNull();
    expect(components?.workSlug).toBe('jujutsu-kaisen');
    expect(components?.storeSlug).toBe('avail');
    expect(components?.eventType).toBe('collabo-cafe');
    expect(components?.year).toBe(2025);
  });
});

describe('isValidCanonicalKey', () => {
  it('should return true for valid canonical keys', () => {
    expect(
      isValidCanonicalKey('jujutsu-kaisen:avail:collabo-cafe:2025')
    ).toBe(true);
    expect(isValidCanonicalKey('spy-family:shimamura:store-collabo:2024')).toBe(
      true
    );
  });

  it('should return false for invalid formats', () => {
    expect(isValidCanonicalKey('invalid-key')).toBe(false);
    expect(isValidCanonicalKey('jujutsu-kaisen:avail:2025')).toBe(false); // too few parts
    expect(
      isValidCanonicalKey('jujutsu-kaisen:avail:collabo-cafe:invalid')
    ).toBe(false); // invalid year
  });

  it('should return false for empty string', () => {
    expect(isValidCanonicalKey('')).toBe(false);
  });
});

describe('Integration: Canonical Key in Duplication Prevention', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should generate consistent keys for same event', async () => {
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    expect(result1.canonicalKey).toBe(result2.canonicalKey);
  });

  it('should generate different keys for different works', async () => {
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      'SPY×FAMILY',
      'アベイル',
      'コラボカフェ',
      2025
    );

    expect(result1.canonicalKey).not.toBe(result2.canonicalKey);
  });

  it('should generate different keys for different stores', async () => {
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'しまむら',
      'コラボカフェ',
      2025
    );

    expect(result1.canonicalKey).not.toBe(result2.canonicalKey);
  });

  it('should generate different keys for different years', async () => {
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2024
    );

    expect(result1.canonicalKey).not.toBe(result2.canonicalKey);
  });

  it('should handle the storeSlug fix (prevent false duplicates)', async () => {
    // Before the fix, these would have had the same key (missing storeSlug)
    // Now they should be different
    const result1 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'アベイル',
      'コラボカフェ',
      2025
    );

    const result2 = await generateCanonicalKeyFromNames(
      '呪術廻戦',
      'しまむら',
      'コラボカフェ',
      2025
    );

    expect(result1.canonicalKey).toContain(':avail:');
    expect(result2.canonicalKey).toContain(':shimamura:');
    expect(result1.canonicalKey).not.toBe(result2.canonicalKey);
  });
});

describe('generateCanonicalKeyFromNames with fallback enabled (Layer 2 contract)', () => {
  beforeEach(() => {
    clearConfigCache();
    mockResolveWorkSlug.mockReset();
    mockResolveStoreSlug.mockReset();
    mockResolveEventTypeSlug.mockReset();
  });

  it('should NOT throw when fallback resolver returns slug for all components', async () => {
    mockResolveWorkSlug.mockResolvedValueOnce('unknown-fallback');
    mockResolveStoreSlug.mockResolvedValueOnce('avail');
    mockResolveEventTypeSlug.mockResolvedValueOnce('collabo-cafe');

    const result = await generateCanonicalKeyFromNames(
      'Completely Unknown',
      'アベイル',
      'コラボカフェ',
      2025
    );

    expect(result.canonicalKey).toBe('unknown-fallback:avail:collabo-cafe:2025');
    expect(result.components).toEqual({
      workSlug: 'unknown-fallback',
      storeSlug: 'avail',
      eventType: 'collabo-cafe',
      year: 2025,
    });
  });
});
