/**
 * Markdown frontmatter パーサーとバリデーション
 *
 * Codexレビュー指摘対応:
 * - z.string().datetime({ offset: true }) でタイムゾーン必須化
 * - categories/tags を non-empty string array に変更
 * - trim() 処理を追加
 */

import { z } from 'zod';

/**
 * Frontmatter スキーマ (WordPress互換メタデータ)
 *
 * 必須フィールド:
 * - id: 記事の一意識別子
 * - title: 記事タイトル
 * - slug: URL用のslug (小文字・ハイフン区切り)
 * - date: ISO 8601形式の日時 (タイムゾーンオフセット必須)
 * - categories: カテゴリ配列 (最低1つ必要)
 * - tags: タグ配列 (最低1つ必要)
 * - excerpt: 記事の要約
 * - author: 著者名
 *
 * オプションフィールド:
 * - ogImage: OGP画像URL
 * - featuredImage: アイキャッチ画像URL (WordPress互換)
 */
export const FrontmatterSchema = z.object({
  id: z.string().trim().min(1, 'ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must be lowercase alphanumeric with hyphens (e.g., "hello-world")'
    ),
  date: z
    .string()
    .datetime({ offset: true, message: 'Date must be ISO 8601 with timezone offset (e.g., "2025-01-15T10:00:00Z")' }),
  categories: z
    .array(z.string().trim().min(1))
    .min(1, 'At least one category is required')
    .transform((arr) => arr.filter((v) => v.length > 0)), // 空文字列除去
  tags: z
    .array(z.string().trim().min(1))
    .min(1, 'At least one tag is required')
    .transform((arr) => arr.filter((v) => v.length > 0)), // 空文字列除去
  excerpt: z.string().trim().min(1, 'Excerpt is required'),
  author: z.string().trim().min(1, 'Author is required'),
  ogImage: z.string().url().optional(),
  featuredImage: z.string().url().optional(),
});

/**
 * Frontmatter型 (Zodスキーマから型推論)
 */
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/**
 * Frontmatterパース結果
 */
export interface ParsedMarkdown {
  metadata: Frontmatter;
  content: string;
}

/**
 * Frontmatterをパースしてバリデーション
 *
 * @param markdown - MDX/Markdown全文 (frontmatter含む)
 * @returns パース結果
 * @throws ZodError - バリデーション失敗時
 * @throws Error - frontmatter形式不正時
 */
export function parseFrontmatter(markdown: string): ParsedMarkdown {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = frontmatterRegex.exec(markdown);

  if (!match) {
    throw new Error('Frontmatter not found in markdown. Expected format: ---\\n...\\n---\\n');
  }

  const [, frontmatterBlock, content] = match;

  // YAML-like形式をパース (簡易版)
  const metadata = parseYamlLike(frontmatterBlock);

  // Zodでバリデーション (エラー時は ZodError がスロー)
  const validated = FrontmatterSchema.parse(metadata);

  return {
    metadata: validated,
    content: content.trim(),
  };
}

/**
 * YAML-like frontmatterをJavaScriptオブジェクトに変換
 *
 * 対応形式:
 * - key: value
 * - key: [val1, val2]
 * - key: 'quoted value'
 *
 * @param yamlText - YAML形式のテキスト
 * @returns パースされたオブジェクト
 */
function parseYamlLike(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlText.trim().split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // 配列の解析 ([val1, val2])
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        // シングルクォートをダブルクォートに変換してJSONパース
        value = JSON.parse(value.replace(/'/g, '"'));
      } catch (e) {
        console.error(`Failed to parse array for key "${key}":`, value);
        value = [];
      }
    } else if (typeof value === 'string') {
      // クォート削除
      value = value.replace(/^["'](.*)["']$/, '$1');
    }

    result[key] = value;
  }

  return result;
}

/**
 * Slug正規化ヘルパー (重複チェック用)
 *
 * Codexレビュー指摘対応:
 * - 小文字化
 * - 連続ハイフンを単一化
 * - 先頭・末尾のスラッシュ・ハイフン除去
 *
 * @param slug - 元のslug
 * @returns 正規化されたslug
 */
export function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/\/+/g, '') // スラッシュ除去
    .replace(/-+/g, '-') // 連続ハイフンを単一化
    .replace(/^-+|-+$/g, ''); // 先頭・末尾のハイフン除去
}

/**
 * 日付からファイル名生成 (YYYY-MM-DD-slug.md)
 *
 * @param date - ISO 8601形式の日付
 * @param slug - 記事slug
 * @returns ファイル名
 */
export function generateFileName(date: string, slug: string): string {
  const dateObj = new Date(date);
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}-${normalizeSlug(slug)}.md`;
}
