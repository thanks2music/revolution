/**
 * Unit tests for Post ID Generation Module
 *
 * @module __tests__/unit/lib/ulid/generate-post-id
 */

import { describe, it, expect } from '@jest/globals';
import {
  generatePostId,
  generateSlugWithYear,
  isValidPostId,
  isValidSlugWithYear,
  parseSlugWithYear,
  type PostId,
} from '../../../../lib/ulid/generate-post-id';

describe('generatePostId', () => {
  it('should generate a 10-character lowercase post ID', () => {
    const postId = generatePostId();

    expect(postId).toBeDefined();
    expect(typeof postId).toBe('string');
    expect(postId.length).toBe(10);
    expect(postId).toMatch(/^[0-9a-z]{10}$/);
  });

  it('should generate unique post IDs with different seed times', () => {
    // Note: ULIDs generated in the same millisecond may be identical
    // In production, articles are generated with sufficient time gaps
    const postId1 = generatePostId({ seedTime: Date.now() });
    const postId2 = generatePostId({ seedTime: Date.now() + 1 });
    const postId3 = generatePostId({ seedTime: Date.now() + 2 });

    expect(postId1).not.toBe(postId2);
    expect(postId2).not.toBe(postId3);
    expect(postId1).not.toBe(postId3);
  });

  it('should generate consistent post ID with same seed time', () => {
    const seedTime = 1234567890000;
    const postId1 = generatePostId({ seedTime });
    const postId2 = generatePostId({ seedTime });

    expect(postId1).toBe(postId2);
  });

  it('should generate different post IDs with different seed times', () => {
    const postId1 = generatePostId({ seedTime: 1234567890000 });
    const postId2 = generatePostId({ seedTime: 1234567890001 });

    expect(postId1).not.toBe(postId2);
  });

  it('should only contain lowercase alphanumeric characters', () => {
    const postId = generatePostId();

    expect(postId).toMatch(/^[0-9a-z]+$/);
    expect(postId).not.toMatch(/[A-Z]/); // No uppercase
    expect(postId).not.toMatch(/[^0-9a-z]/); // No special chars
  });

  it('should support custom length', () => {
    const postId5 = generatePostId({ length: 5 });
    const postId15 = generatePostId({ length: 15 });

    expect(postId5.length).toBe(5);
    expect(postId15.length).toBe(15);
  });
});

describe('generateSlugWithYear', () => {
  it('should generate slug with year suffix in correct format', () => {
    const slug = generateSlugWithYear(2025);

    expect(slug).toMatch(/^[0-9a-z]{10}-2025$/);
  });

  it('should generate slug with different years', () => {
    const slug2024 = generateSlugWithYear(2024);
    const slug2025 = generateSlugWithYear(2025);
    const slug2026 = generateSlugWithYear(2026);

    expect(slug2024).toContain('-2024');
    expect(slug2025).toContain('-2025');
    expect(slug2026).toContain('-2026');
  });

  it('should throw error for invalid year (non-integer)', () => {
    expect(() => generateSlugWithYear(2025.5)).toThrow('positive integer');
  });

  it('should throw error for invalid year (negative)', () => {
    expect(() => generateSlugWithYear(-2025)).toThrow('positive integer');
  });

  it('should throw error for invalid year (zero)', () => {
    expect(() => generateSlugWithYear(0)).toThrow('positive integer');
  });

  it('should throw error for year out of reasonable range (too old)', () => {
    expect(() => generateSlugWithYear(2019)).toThrow('between 2020 and 2100');
  });

  it('should throw error for year out of reasonable range (too future)', () => {
    expect(() => generateSlugWithYear(2101)).toThrow('between 2020 and 2100');
  });

  it('should generate consistent slug with same seed time and year', () => {
    const seedTime = 1234567890000;
    const slug1 = generateSlugWithYear(2025, { seedTime });
    const slug2 = generateSlugWithYear(2025, { seedTime });

    expect(slug1).toBe(slug2);
  });
});

describe('isValidPostId', () => {
  it('should validate correct post ID format', () => {
    const validPostId = generatePostId();
    expect(isValidPostId(validPostId)).toBe(true);
  });

  it('should return true for 10-character lowercase alphanumeric', () => {
    expect(isValidPostId('01jcxy4567')).toBe(true);
    expect(isValidPostId('abcdefghij')).toBe(true);
    expect(isValidPostId('0123456789')).toBe(true);
  });

  it('should return false for uppercase characters', () => {
    expect(isValidPostId('01JCXY4567')).toBe(false);
    expect(isValidPostId('01JcXy4567')).toBe(false);
  });

  it('should return false for wrong length', () => {
    expect(isValidPostId('short')).toBe(false);
    expect(isValidPostId('toolongpostid123')).toBe(false);
    expect(isValidPostId('')).toBe(false);
  });

  it('should return false for special characters', () => {
    expect(isValidPostId('01jcxy456-')).toBe(false);
    expect(isValidPostId('01jcxy456_')).toBe(false);
    expect(isValidPostId('01jcxy456@')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(isValidPostId(123 as any)).toBe(false);
    expect(isValidPostId(null as any)).toBe(false);
    expect(isValidPostId(undefined as any)).toBe(false);
  });
});

describe('isValidSlugWithYear', () => {
  it('should validate correct slug format', () => {
    const validSlug = generateSlugWithYear(2025);
    expect(isValidSlugWithYear(validSlug)).toBe(true);
  });

  it('should return true for valid format', () => {
    expect(isValidSlugWithYear('01jcxy4567-2025')).toBe(true);
    expect(isValidSlugWithYear('abcdefghij-2024')).toBe(true);
    expect(isValidSlugWithYear('0123456789-2026')).toBe(true);
  });

  it('should return false for missing year', () => {
    expect(isValidSlugWithYear('01jcxy4567')).toBe(false);
    expect(isValidSlugWithYear('01jcxy4567-')).toBe(false);
  });

  it('should return false for wrong year format', () => {
    expect(isValidSlugWithYear('01jcxy4567-25')).toBe(false); // 2 digits
    expect(isValidSlugWithYear('01jcxy4567-202')).toBe(false); // 3 digits
    expect(isValidSlugWithYear('01jcxy4567-20255')).toBe(false); // 5 digits
  });

  it('should return false for wrong post ID length', () => {
    expect(isValidSlugWithYear('short-2025')).toBe(false);
    expect(isValidSlugWithYear('toolongpostid-2025')).toBe(false);
  });

  it('should return false for uppercase in post ID', () => {
    expect(isValidSlugWithYear('01JCXY4567-2025')).toBe(false);
  });

  it('should return false for invalid format', () => {
    expect(isValidSlugWithYear('01jcxy4567_2025')).toBe(false); // underscore
    expect(isValidSlugWithYear('01jcxy4567 2025')).toBe(false); // space
    expect(isValidSlugWithYear('')).toBe(false); // empty
  });
});

describe('parseSlugWithYear', () => {
  it('should parse valid slug correctly', () => {
    const result = parseSlugWithYear('01jcxy4567-2025');

    expect(result).not.toBeNull();
    expect(result?.postId).toBe('01jcxy4567');
    expect(result?.year).toBe(2025);
  });

  it('should parse different years correctly', () => {
    const result2024 = parseSlugWithYear('abcdefghij-2024');
    const result2026 = parseSlugWithYear('0123456789-2026');

    expect(result2024?.year).toBe(2024);
    expect(result2026?.year).toBe(2026);
  });

  it('should return null for invalid slug format', () => {
    expect(parseSlugWithYear('invalid-slug')).toBeNull();
    expect(parseSlugWithYear('01jcxy4567')).toBeNull();
    expect(parseSlugWithYear('01jcxy4567-25')).toBeNull();
    expect(parseSlugWithYear('01JCXY4567-2025')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseSlugWithYear('')).toBeNull();
  });

  it('should handle round-trip generation and parsing', () => {
    const originalYear = 2025;
    const slug = generateSlugWithYear(originalYear);
    const parsed = parseSlugWithYear(slug);

    expect(parsed).not.toBeNull();
    expect(parsed?.year).toBe(originalYear);
    expect(parsed?.postId).toMatch(/^[0-9a-z]{10}$/);
  });
});

describe('Integration: Real-world usage scenarios', () => {
  it('should generate valid slugs for MVP use case', () => {
    // Simulate generating slug for a 2025 collaboration cafe event
    const year = new Date().getFullYear();
    const slug = generateSlugWithYear(year);

    // Validate slug can be parsed back
    const parsed = parseSlugWithYear(slug);
    expect(parsed).not.toBeNull();
    expect(parsed?.year).toBe(year);

    // Validate slug is URL-safe
    expect(slug).toMatch(/^[0-9a-z-]+$/);
  });

  it('should generate multiple unique slugs for same year', () => {
    const year = 2025;
    const slugs = new Set<string>();

    // Generate 100 slugs with different seed times to ensure uniqueness
    // Note: In production, articles are generated with sufficient time gaps
    for (let i = 0; i < 100; i++) {
      const slug = generateSlugWithYear(year, { seedTime: Date.now() + i });
      slugs.add(slug);
    }

    // All slugs should be unique
    expect(slugs.size).toBe(100);

    // All slugs should end with same year
    slugs.forEach((slug) => {
      expect(slug).toContain('-2025');
    });
  });

  it('should work in canonical key generation scenario', () => {
    // Simulate generating canonicalKey components
    const workSlug = 'jujutsu-kaisen';
    const storeSlug = 'animate-cafe';
    const eventType = 'collabo-cafe';
    const year = 2025;

    const postId = generatePostId();
    const slug = generateSlugWithYear(year);

    // Canonical key format: workSlug:storeSlug:eventType:year
    const canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;

    expect(canonicalKey).toBe('jujutsu-kaisen:animate-cafe:collabo-cafe:2025');
    expect(isValidPostId(postId)).toBe(true);
    expect(isValidSlugWithYear(slug)).toBe(true);
  });
});
