/**
 * Unit tests for Post ID Generation Module
 *
 * @module __tests__/unit/lib/ulid/generate-post-id
 */

import { describe, it, expect } from '@jest/globals';
import {
  generatePostId,
  isValidPostId,
  POST_ID_TIMESTAMP_LENGTH,
  type PostId,
} from '../../../../lib/ulid/generate-post-id';

describe('generatePostId', () => {
  it('should generate a 10-character lowercase post ID', () => {
    const postId = generatePostId();

    expect(postId).toBeDefined();
    expect(typeof postId).toBe('string');
    expect(postId.length).toBe(16);
    expect(postId).toMatch(/^[0-9a-z]{16}$/);
  });

  it('should generate unique post IDs with different seed times', () => {
    const postId1 = generatePostId({ seedTime: Date.now() });
    const postId2 = generatePostId({ seedTime: Date.now() + 1 });
    const postId3 = generatePostId({ seedTime: Date.now() + 2 });

    expect(postId1).not.toBe(postId2);
    expect(postId2).not.toBe(postId3);
    expect(postId1).not.toBe(postId3);
  });

  /**
   * ★ 2026-08-14 に**前提を反転させたテスト**。
   *
   * 旧テストは `should generate consistent post ID with same seed time` という名前で
   * **同一 seedTime なら同一 ID になることを「仕様」として固定していた**。
   * これは `slice(0, 10)` がタイムスタンプ部しか残さなかったことの裏返しで、
   * `post_id` = 記事の公開 URL である以上「同一ミリ秒の 2 記事が同じ URL を持つ」
   * ことを固定していたに等しい。
   *
   * ランダム部を含めた今は、**同一 seedTime でも衝突しない**ことが仕様。
   */
  it('should NOT collide when generated within the same millisecond', () => {
    const seedTime = 1234567890000;
    const ids = new Set(
      Array.from({ length: 50 }, () => generatePostId({ seedTime })),
    );

    // 旧実装ではここが 1 になっていた (50 件すべて同一値)。
    expect(ids.size).toBe(50);
  });

  it('keeps the timestamp prefix stable for the same millisecond (sortability)', () => {
    // 衝突を消しても**時刻順ソート可能性は維持する**のが ULID を使う理由。
    // 先頭 10 文字 (タイムスタンプ部) は同一ミリ秒なら一致する。
    const seedTime = 1234567890000;
    const a = generatePostId({ seedTime });
    const b = generatePostId({ seedTime });

    expect(a.slice(0, POST_ID_TIMESTAMP_LENGTH)).toBe(b.slice(0, POST_ID_TIMESTAMP_LENGTH));
    expect(a).not.toBe(b);
  });

  it('rejects a length that would erase the randomness', () => {
    // ここを緩めると「同一ミリ秒で同じ ID」が復活する。
    expect(() => generatePostId({ length: POST_ID_TIMESTAMP_LENGTH })).toThrow(
      /タイムスタンプ部/,
    );
    expect(() => generatePostId({ length: 8 })).toThrow(/タイムスタンプ部/);
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

  it('validates a custom-length ID when the same length is passed to isValidPostId', () => {
    // 生成が任意長を許すのに検証が固定長だと非対称になる (PR #303 レビュー指摘)。
    const long = generatePostId({ length: 20 });
    expect(isValidPostId(long)).toBe(false); // 既定 (16) では弾かれる
    expect(isValidPostId(long, 20)).toBe(true); // 同じ長さを渡せば通る
  });

  it('should support custom length above the timestamp prefix', () => {
    // ⚠️ 旧テストは length: 5 を「サポートする」と固定していたが、5 文字では
    //    タイムスタンプ部すら収まらず**ランダム部が完全に消える**。
    //    ランダム部を残せる長さ (> 10) のみを許可する仕様に変えた (2026-08-14)。
    const postId15 = generatePostId({ length: 15 });
    const postId20 = generatePostId({ length: 20 });

    expect(postId15.length).toBe(15);
    expect(postId20.length).toBe(20);
  });
});

describe('isValidPostId', () => {
  it('should validate correct post ID format', () => {
    const validPostId = generatePostId();
    expect(isValidPostId(validPostId)).toBe(true);
  });

  it('should return true for 10-character lowercase alphanumeric', () => {
    expect(isValidPostId('01jcxy4567znp2f5')).toBe(true);
    expect(isValidPostId('abcdefghijklmnop')).toBe(true);
    expect(isValidPostId('0123456789012345')).toBe(true);
  });

  it('should return false for uppercase characters', () => {
    expect(isValidPostId('01JCXY4567ZNP2F5')).toBe(false);
    expect(isValidPostId('01JcXy4567ZnP2f5')).toBe(false);
  });

  it('should return false for wrong length', () => {
    expect(isValidPostId('short')).toBe(false);
    expect(isValidPostId('toolongpostid1234567')).toBe(false);
    expect(isValidPostId('')).toBe(false);
  });

  it('should return false for special characters', () => {
    expect(isValidPostId('01jcxy4567znp2f-')).toBe(false);
    expect(isValidPostId('01jcxy4567znp2f_')).toBe(false);
    expect(isValidPostId('01jcxy4567znp2f@')).toBe(false);
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
    expect(postId).toMatch(/^[0-9a-z]{16}$/);

    // Validate post ID is URL-safe
    expect(postId).toMatch(/^[0-9a-z]+$/);
  });

  it('should generate multiple unique post IDs', () => {
    const postIds = new Set<string>();

    // **同一 seedTime で 100 件**生成する。seedTime をずらして通すのは
    // 衝突の回避であって検証ではない (2026-08-14 に前提を反転)。
    const seedTime = Date.now();
    for (let i = 0; i < 100; i++) {
      postIds.add(generatePostId({ seedTime }));
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
    const workSlug = 'sample-work';
    const storeSlug = 'animate-cafe';
    const eventType = 'collabo-cafe';
    const year = 2025;

    const postId = generatePostId();

    // Canonical key format: workSlug:storeSlug:eventType:year
    const canonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;

    expect(canonicalKey).toBe('sample-work:animate-cafe:collabo-cafe:2025');
    expect(isValidPostId(postId)).toBe(true);
  });
});
