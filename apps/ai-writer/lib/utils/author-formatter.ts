/**
 * @fileoverview Author Name Type Guard Functions for v1.4.0
 *
 * @description
 * 複数原作者対応のためのType Guard関数群。
 * `原作者名` の型が `string | string[] | null` に拡張されたため、
 * 安全な型変換と統一フォーマットへの変換を提供します。
 *
 * ## 重要な仕様
 * - **原作者名のセパレーターは常に " / " 固定** （メディアタイプに依存しません）
 * - 理由: 原作者は作品のクリエイターであり、キャラクターやメンバーとは異なる
 * - メディアタイプ別セパレーター（"・" vs " / "）は `メンバー名` `キャラクター名` にのみ適用
 *
 * @example
 * // 単一原作者
 * formatAuthorName('尾田栄一郎先生') // → '尾田栄一郎先生'
 *
 * // 複数原作者（常に " / " で結合）
 * formatAuthorName(['CLAMP先生', '新條まゆ先生']) // → 'CLAMP先生 / 新條まゆ先生'
 *
 * // null の場合
 * formatAuthorName(null) // → ''
 *
 * @see /notes/04-review/2026-01-12-01-v1.4.0設計草案v1-修正版.md
 * @since v1.4.0
 */

/**
 * 原作者名を統一フォーマットに変換
 *
 * @param name - 原作者名（単一 | 配列 | null）
 * @returns 統一フォーマットの文字列（nullの場合は空文字列）
 *
 * @description
 * - 単一原作者: そのまま返却
 * - 複数原作者: " / " で結合（固定セパレーター）
 * - null: 空文字列を返却
 *
 * @remarks
 * **注意**: 原作者名は常に " / " で結合します。メディアタイプに依存しません。
 * メディアタイプ別セパレーター（"・" vs " / "）は `メンバー名` や `キャラクター名` にのみ適用されます。
 *
 * @example
 * formatAuthorName('尾田栄一郎先生') // → '尾田栄一郎先生'
 * formatAuthorName(['CLAMP先生', '新條まゆ先生']) // → 'CLAMP先生 / 新條まゆ先生'
 * formatAuthorName(null) // → ''
 */
export function formatAuthorName(name: string | string[] | null | undefined): string {
  if (!name) return '';
  if (Array.isArray(name)) {
    return name.join(' / '); // 原作者名専用セパレーター（固定）
  }
  return name;
}

/**
 * 複数原作者が存在するかチェック
 *
 * @param name - 原作者名（単一 | 配列 | null）
 * @returns 配列型かつ2人以上の場合true
 *
 * @description
 * YAML テンプレート内の条件分岐で使用されることを想定。
 * `{{#if has_multiple_authors}}` のような条件判定をTypeScript側で提供。
 *
 * @example
 * hasMultipleAuthors('尾田栄一郎先生') // → false
 * hasMultipleAuthors(['CLAMP先生']) // → false（1人のみ）
 * hasMultipleAuthors(['CLAMP先生', '新條まゆ先生']) // → true
 * hasMultipleAuthors(null) // → false
 */
export function hasMultipleAuthors(name: string | string[] | null | undefined): boolean {
  return Array.isArray(name) && name.length >= 2;
}

/**
 * 原作者名を配列形式で取得
 *
 * @param name - 原作者名（単一 | 配列 | null）
 * @returns 常に配列を返却（nullの場合は空配列）
 *
 * @description
 * ループ処理や個別アクセスが必要な場合に使用。
 * 単一原作者も配列化することで、統一的な処理が可能になる。
 *
 * @example
 * getAuthorNamesAsArray('尾田栄一郎先生') // → ['尾田栄一郎先生']
 * getAuthorNamesAsArray(['CLAMP先生', '新條まゆ先生']) // → ['CLAMP先生', '新條まゆ先生']
 * getAuthorNamesAsArray(null) // → []
 */
export function getAuthorNamesAsArray(name: string | string[] | null | undefined): string[] {
  if (!name) return [];
  if (Array.isArray(name)) return name;
  return [name];
}

/**
 * Type Guard: 原作者名が文字列型かチェック
 *
 * @param name - 原作者名（単一 | 配列 | null）
 * @returns 文字列型の場合true（型ガード）
 *
 * @description
 * TypeScriptの型絞り込み（Type Narrowing）に使用。
 * if文内で使用することで、以降のブロックで型が `string` に確定する。
 *
 * @example
 * const name = getAuthorName(); // string | string[] | null
 * if (isString(name)) {
 *   // この中では name は string 型として扱える
 *   console.log(name.toUpperCase());
 * }
 */
export function isString(name: string | string[] | null): name is string {
  return typeof name === 'string';
}

/**
 * Type Guard: 原作者名が配列型かチェック
 *
 * @param name - 原作者名（単一 | 配列 | null）
 * @returns 配列型の場合true（型ガード）
 *
 * @description
 * TypeScriptの型絞り込み（Type Narrowing）に使用。
 * if文内で使用することで、以降のブロックで型が `string[]` に確定する。
 *
 * @example
 * const name = getAuthorName(); // string | string[] | null
 * if (isArray(name)) {
 *   // この中では name は string[] 型として扱える
 *   console.log(`原作者数: ${name.length}`);
 * }
 */
export function isArray(name: string | string[] | null): name is string[] {
  return Array.isArray(name);
}
