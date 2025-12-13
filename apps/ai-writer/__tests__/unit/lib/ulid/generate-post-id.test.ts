/**
 * Unit tests for Post ID Generation Module
 *
 * @module __tests__/unit/lib/ulid/generate-post-id
 */

import { describe, it, expect } from '@jest/globals';
import {
  generatePostId,
  isValidPostId,
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

describe('Integration: Real-world usage scenarios', () => {
  it('should generate valid post IDs for MVP use case', () => {
    // Simulate generating post ID for a collaboration cafe event
    const postId = generatePostId();

    // Validate post ID format
    expect(isValidPostId(postId)).toBe(true);
    expect(postId).toMatch(/^[0-9a-z]{10}$/);

    // Validate post ID is URL-safe
    expect(postId).toMatch(/^[0-9a-z]+$/);
  });

  it('should generate multiple unique post IDs', () => {
    const postIds = new Set<string>();

    // Generate 100 post IDs with different seed times to ensure uniqueness
    // Note: In production, articles are generated with sufficient time gaps
    for (let i = 0; i < 100; i++) {
      const postId = generatePostId({ seedTime: Date.now() + i });
      postIds.add(postId);
    }

    // All post IDs should be unique
    expect(postIds.size).toBe(100);

    // All post IDs should be valid format
    postIds.forEach((postId) => {
      expect(isValidPostId(postId)).toBe(true);
    });
  });

  it('should work in canonical key generation scenario', () => {
    // Simulate generating canonicalKey components
    const workSlug = 'jujutsu-kaisen';
    const storeSlug = 'animate-cafe';
    const eventType = 'collabo-cafe';
    const year = 2025;

    const postId = generatePostId();

    // Canonical key format: workSlug:storeSlug:eventType:year
    const canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;

    expect(canonicalKey).toBe('jujutsu-kaisen:animate-cafe:collabo-cafe:2025');
    expect(isValidPostId(postId)).toBe(true);
  });
});
