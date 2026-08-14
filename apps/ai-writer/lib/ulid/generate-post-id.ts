/**
 * Post ID Generation Module
 *
 * Purpose:
 *   - Generate unique post IDs using ULID (Universally Unique Lexicographically Sortable Identifier)
 *   - Ensures chronological sortability and global uniqueness
 *   - Used for article slug generation in MVP Phase 0.1
 *
 * Implementation:
 *   - Uses ULID library for base generation
 *   - Converts to lowercase for URL-friendly format
 *   - Keeps the 10-char timestamp prefix + 6 chars of randomness (16 chars total)
 *
 * ## ⚠️ 2026-08-14: 10 文字への切り詰めをやめた (衝突していた)
 *
 * 旧実装は `ulid().slice(0, 10)` だった。**ULID の先頭 10 文字はタイムスタンプ部
 * (48bit) であり、ランダム部 (80bit / 16 文字) を全部捨てていた**。結果:
 *
 *   - 同一ミリ秒で生成した ID が**完全に同一**になる (実測: 3 件生成して一意な値 1)
 *   - ID がタイムスタンプのみ = **列挙可能**
 *
 * `post_id` は記事の slug (= 公開 URL `/articles/{post_id}`) と同一値
 * (`lib/mdx/template-generator.ts`) なので、これは**記事の公開 URL が衝突する**
 * ということ。`post_id` の一意性を担保する仕組みは他のどこにも無く
 * (Firestore の doc ID は canonicalKey)、既存テストは衝突を修正せず
 * `seedTime` をずらして回避していた。
 *
 * 現状は記事生成が逐次実行なので同一ミリ秒の衝突は起きにくいが、S5 の自動化
 * (Scheduler / 並列実行) で確率が上がる。**記事が実質 0 件の今しか桁数を変えられない**
 * (2026-08-14 BOSS 承認)。
 *
 * 経緯: `one-more-time/docs/schema/favorites-opaque-key-plan.md` §2
 *
 * @module lib/ulid/generate-post-id
 * @see {@link /notes/archive/super-mvp-scope.md} for specification details
 */

import { ulid } from 'ulid';

/**
 * Post ID type definition
 * @description A 16-character lowercase ULID prefix (10-char timestamp + 6-char randomness)
 * @example "01jcxy4567znp2f5"
 */
export type PostId = string;

/**
 * Post ID configuration options
 */
export interface GeneratePostIdOptions {
  /**
   * Optional seed time for ULID generation (for testing purposes)
   * @default Date.now()
   */
  seedTime?: number;

  /**
   * Length of the generated post ID.
   *
   * ⚠️ **10 以下にしないこと。** ULID の先頭 10 文字はタイムスタンプ部なので、
   * 10 文字で切るとランダム部が消えて同一ミリ秒の生成が衝突する。
   * `POST_ID_TIMESTAMP_LENGTH` より大きい値を渡すこと。
   *
   * @default 16
   */
  length?: number;
}

/**
 * ULID のタイムスタンプ部の長さ (仕様)。48bit を Crockford base32 で 10 文字。
 * **これ以下に切るとランダム部が完全に消える。**
 */
export const POST_ID_TIMESTAMP_LENGTH = 10;

/**
 * Default configuration
 *
 * 16 = タイムスタンプ 10 + ランダム 6 文字 (30bit)。
 *
 * ランダム 6 文字を選んだ理由: 同一ミリ秒に N 件生成したときの衝突確率は
 * 概ね N² / (2 × 2^30)。N=50 (S5 の並列生成を想定した上限) でも約 0.0001% に収まる。
 * 4 文字 (20bit) だと同条件で約 0.12% で、**衝突すると 2 記事が同じ公開 URL を
 * 持つ**うえ気づく手段が無いため、余裕を取った。
 */
const DEFAULT_CONFIG = {
  length: 16,
} as const;

/**
 * Generates a unique post ID using ULID
 *
 * @description
 * Creates a 16-character lowercase ULID prefix for use in article slugs.
 * ULIDs are:
 * - Lexicographically sortable (timestamp-based)
 * - Collision-resistant (10-char timestamp + 6-char randomness = 30bit per millisecond)
 * - URL-safe (lowercase alphanumeric)
 *
 * @param {GeneratePostIdOptions} options - Configuration options
 * @returns {PostId} A 16-character lowercase ULID prefix
 *
 * @example
 * ```typescript
 * const postId = generatePostId();
 * console.log(postId); // "01jcxy4567znp2f5"
 *
 * // With custom seed time (for testing)
 * const testPostId = generatePostId({ seedTime: 1234567890000 });
 * ```
 *
 * @throws {Error} If ULID generation fails
 */
export function generatePostId(options: GeneratePostIdOptions = {}): PostId {
  const { seedTime, length = DEFAULT_CONFIG.length } = options;

  // ランダム部が 1 文字も残らない長さを黙って受け付けない。
  // ここを緩めると「同一ミリ秒で同じ ID」が復活する。
  if (length <= POST_ID_TIMESTAMP_LENGTH) {
    throw new Error(
      `Invalid post ID length: ${length}. ULID の先頭 ${POST_ID_TIMESTAMP_LENGTH} 文字は` +
        'タイムスタンプ部のため、それ以下に切るとランダム部が消えて同一ミリ秒の生成が衝突します。',
    );
  }

  try {
    // Generate ULID with optional seed time
    const rawUlid = seedTime !== undefined ? ulid(seedTime) : ulid();

    // Convert to lowercase and truncate to specified length
    const postId = rawUlid.toLowerCase().slice(0, length);

    // Validation: Ensure post ID meets requirements
    if (postId.length !== length) {
      throw new Error(
        `Generated post ID has invalid length: expected ${length}, got ${postId.length}`
      );
    }

    // Validation: Ensure alphanumeric only
    if (!/^[0-9a-z]+$/.test(postId)) {
      throw new Error(
        `Generated post ID contains invalid characters: ${postId}`
      );
    }

    return postId;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate post ID: ${error.message}`);
    }
    throw new Error('Failed to generate post ID: Unknown error');
  }
}

/**
 * Validates if a string is a valid post ID
 *
 * ⚠️ **既定の期待長は `DEFAULT_CONFIG.length` (16)**。`generatePostId({ length })` で
 * カスタム長を生成した場合、既定のままだと弾かれる。**生成時と検証時で同じ長さを
 * 渡すこと。** (PR #303 レビュー指摘: 生成が任意長を許すのに検証が固定長で、
 * 非対称になっていた)
 *
 * @param {string} postId - The post ID to validate
 * @param {number} [expectedLength] - 期待する長さ。既定は生成時の既定長 (16)
 * @returns {boolean} True if valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidPostId("01jcxy4567znp2f5"); // true
 * isValidPostId("01JCXY4567ZNP2F5"); // false (uppercase not allowed)
 * isValidPostId("01jcxy4567");       // false (too short — 旧 10 文字形式)
 * ```
 */
export function isValidPostId(postId: string, expectedLength: number = DEFAULT_CONFIG.length): boolean {
  return (
    typeof postId === 'string' &&
    postId.length === expectedLength &&
    /^[0-9a-z]+$/.test(postId)
  );
}
