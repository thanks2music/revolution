/**
 * Slug Generator Module with Fallback Chain
 *
 * Purpose:
 *   - Generate URL-friendly slugs from Japanese text
 *   - Implement fallback chain: AI API → ASCII slugify → error
 *   - Support MDX Pipeline production flow (Phase 0.2)
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 *
 * @module lib/config/slug-generator
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Section: Step 7 YAML fallback
 */

import { createAiProvider } from '@/lib/ai/factory/ai-factory';

/**
 * Generate URL-friendly slug from Japanese text using AI API
 *
 * @param japaneseText - Japanese text (e.g., "呪術廻戦", "BOX cafe&space")
 * @param context - Context hint for AI (e.g., "anime title", "cafe name")
 * @returns URL-friendly slug (e.g., "jujutsu-kaisen", "box-cafe-and-space")
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithAI("呪術廻戦", "anime title");
 * console.log(slug); // "jujutsu-kaisen"
 * ```
 */
export async function generateSlugWithAI(
  japaneseText: string,
  context?: string
): Promise<string> {
  const aiProvider = createAiProvider();

  const prompt = `あなたはURL生成エキスパートです。以下の日本語テキストをURL-friendlyな英語スラグに変換してください。

## 変換ルール
1. 日本語をローマ字（またはよく知られた英語表記）に変換
2. 小文字のみ使用
3. 単語の区切りはハイフン（-）を使用
4. 英数字とハイフン以外は削除
5. 連続するハイフンは1つに統合
6. 先頭・末尾のハイフンは削除

## 入力
**テキスト**: ${japaneseText}
${context ? `**コンテキスト**: ${context}` : ''}

## 出力形式
スラグのみを出力してください。説明は不要です。

例:
- 入力: "呪術廻戦" → 出力: "jujutsu-kaisen"
- 入力: "BOX cafe&space" → 出力: "box-cafe-and-space"
- 入力: "アベイル" → 出力: "avail"`;

  // AI Provider経由でAPI呼び出し（マルチプロバイダー対応）
  const response = await aiProvider.sendMessage(prompt, {
    maxTokens: 100,
    temperature: 0,
    responseFormat: 'text',
  });

  // Clean up response (remove any extra whitespace or formatting)
  const slug = response.content.trim().toLowerCase();

  // Validate slug format (alphanumeric + hyphens only)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Generated slug contains invalid characters: "${slug}"`);
  }

  return slug;
}

/**
 * @deprecated Use generateSlugWithAI instead
 */
export const generateSlugWithClaude = generateSlugWithAI;

/**
 * Generate ASCII slug as final fallback
 *
 * @description
 * Simple slugification:
 * - Remove non-ASCII characters
 * - Convert to lowercase
 * - Replace spaces with hyphens
 * - Remove special characters
 * - Collapse multiple hyphens
 *
 * @param text - Text to slugify
 * @returns ASCII slug
 *
 * @example
 * ```typescript
 * const slug = generateAsciiSlug("Hello World!");
 * console.log(slug); // "hello-world"
 * ```
 */
export function generateAsciiSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD') // Normalize unicode
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Generate slug with full fallback chain
 *
 * @description
 * Fallback chain:
 * 1. Try AI API for intelligent Japanese → Romaji conversion (multi-provider support)
 * 2. If AI fails, use ASCII slugify
 * 3. If result is empty, throw error
 *
 * @param japaneseText - Japanese text to convert
 * @param context - Optional context for AI
 * @returns Generated slug
 * @throws Error if all fallback methods fail
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithFallback("呪術廻戦", "anime title");
 * console.log(slug); // "jujutsu-kaisen" (from AI API)
 * ```
 */
export async function generateSlugWithFallback(
  japaneseText: string,
  context?: string
): Promise<string> {
  // Try AI API first (multi-provider support)
  try {
    console.log(
      `[Slug Generator] Trying AI API for: "${japaneseText}"${context ? ` (${context})` : ''}`
    );
    const aiSlug = await generateSlugWithAI(japaneseText, context);
    console.log(`[Slug Generator] ✅ AI API generated: "${aiSlug}"`);
    return aiSlug;
  } catch (error) {
    console.warn(
      `[Slug Generator] ⚠️ AI API failed for "${japaneseText}":`,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Fallback to ASCII slugify
  console.log(`[Slug Generator] Trying ASCII fallback for: "${japaneseText}"`);
  const asciiSlug = generateAsciiSlug(japaneseText);

  if (asciiSlug.length === 0) {
    throw new Error(
      `Failed to generate slug for "${japaneseText}": No ASCII characters found. Please add entry to YAML config.`
    );
  }

  console.log(`[Slug Generator] ⚠️ ASCII fallback generated: "${asciiSlug}" (may not be ideal)`);
  return asciiSlug;
}
