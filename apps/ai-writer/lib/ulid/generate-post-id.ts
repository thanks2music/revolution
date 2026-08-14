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

}

/**
 * ULID のタイムスタンプ部の長さ (仕様)。48bit を Crockford base32 で 10 文字。
 * テストが「タイムスタンプ部は同一ミリ秒なら一致する」を確認するために参照する。
 */
export const POST_ID_TIMESTAMP_LENGTH = 10;

/**
 * post_id の長さ。**タイムスタンプ 10 + ランダム 6 文字 (30bit)**。
 *
 * ランダム 6 文字を選んだ理由: 同一ミリ秒に N 件生成したときの衝突確率は
 * 概ね N² / (2 × 2^30)。N=50 (S5 の並列生成を想定した上限) でも約 0.0001% に収まる。
 * 4 文字 (20bit) だと同条件で約 0.12% で、**衝突すると 2 記事が同じ公開 URL を
 * 持つ**うえ気づく手段が無いため、余裕を取った。
 *
 * ⚠️ **可変長にはしない。** 以前は `length` オプションを持っていたが、
 * 本番の呼び出し側は誰も使わずテスト専用で、その 1 つの knob が
 * 「10 以下を弾く throw」「isValidPostId の第 2 引数」「生成と検証の非対称」
 * (PR #303 レビュー指摘) を連鎖的に生んでいた。YAGNI に従い撤去した。
 * 可変長が本当に必要になった時に足す。
 */
export const POST_ID_LENGTH = 16;

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
  const { seedTime } = options;

  try {
    // Generate ULID with optional seed time
    const rawUlid = seedTime !== undefined ? ulid(seedTime) : ulid();

    // タイムスタンプ部 + ランダム部の先頭を残す (ランダム部を捨てないこと)。
    const postId = rawUlid.toLowerCase().slice(0, POST_ID_LENGTH);

    // Validation: Ensure post ID meets requirements
    if (postId.length !== POST_ID_LENGTH) {
      throw new Error(
        `Generated post ID has invalid length: expected ${POST_ID_LENGTH}, got ${postId.length}`
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
 * 生成側が固定長 (`POST_ID_LENGTH`) になったので、期待長を引数で受けない。
 * 以前は可変長を許して第 2 引数を持っていたが、生成と検証で長さを渡し忘れる
 * 非対称を生んでいた (PR #303)。
 *
 * @param {string} postId - The post ID to validate
 * @returns {boolean} True if valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidPostId("01jcxy4567znp2f5"); // true
 * isValidPostId("01JCXY4567ZNP2F5"); // false (uppercase not allowed)
 * isValidPostId("01jcxy4567");       // false (too short — 旧 10 文字形式)
 * ```
 */
export function isValidPostId(postId: string): boolean {
  return (
    typeof postId === 'string' && postId.length === POST_ID_LENGTH && /^[0-9a-z]+$/.test(postId)
  );
}
