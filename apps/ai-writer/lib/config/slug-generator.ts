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
import type { CostTrackerService } from '@/lib/ai/cost';

/**
 * Generate URL-friendly slug from Japanese text using AI API
 *
 * @param japaneseText - Japanese text (e.g., "作品名", "店舗名")
 * @param context - Context hint for AI (e.g., "anime title", "cafe name")
 * @param costTracker - Optional cost tracker for recording API usage
 * @returns URL-friendly slug (e.g., "work-slug", "store-slug")
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithAI("作品名", "anime title");
 * console.log(slug); // "work-slug"
 * ```
 */
export async function generateSlugWithAI(
  japaneseText: string,
  context?: string,
  costTracker?: CostTrackerService
): Promise<string> {
  const aiProvider = createAiProvider();

  // コンテキストに応じてプロンプトを分岐
  const isAnimeTitle = context?.includes('anime') || context?.includes('manga') || context?.includes('title');

  const prompt = isAnimeTitle
    ? `あなたはアニメ・漫画の公式英語タイトルに詳しいエキスパートです。

## タスク
以下の日本語作品タイトルの**公式英語タイトル**をベースにURL-friendlyなスラグを生成してください。

## 重要ルール
1. **公式英語タイトルを優先**: Wikipedia英語版で使用されている正式名称を使用
   - 例: 「機動戦士ガンダム 鉄血のオルフェンズ」→ "Mobile Suit Gundam: Iron-Blooded Orphans" → "gundam-iron-blooded-orphans"
   - 例: 「ブルーロック」→ "Blue Lock" → "blue-lock"
   - 例: 「らんま1/2」→ "Ranma ½" → "ranma"
   - 例: 「鬼滅の刃」→ "Demon Slayer" → "demon-slayer"
   - 例: 「進撃の巨人」→ "Attack on Titan" → "attack-on-titan"
2. 公式英語タイトルが不明な場合のみローマ字変換（ヘボン式）
3. 小文字のみ、単語区切りはハイフン（-）、英数字とハイフンのみ
4. 連続するハイフンは1つに統合、先頭・末尾のハイフンは削除
5. 冠詞（the, a, an）や副題は省略可（短く簡潔に）

## 入力
**作品タイトル**: ${japaneseText}

## 出力形式
スラグのみを出力してください。説明は不要です。
公式英語タイトルが不明で自信がない場合は "UNKNOWN" と出力してください。`
    : `あなたはURL生成エキスパートです。以下の日本語テキストをURL-friendlyな英語スラグに変換してください。

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
- 入力: "BOX cafe&space" → 出力: "box-cafe-and-space"
- 入力: "アベイル" → 出力: "avail"
- 入力: "しまむら" → 出力: "shimamura"`;

  // AI Provider経由でAPI呼び出し（マルチプロバイダー対応）
  const response = await aiProvider.sendMessage(prompt, {
    maxTokens: 100,
    temperature: 0,
    responseFormat: 'text',
  });

  // コストを記録（costTracker が渡された場合のみ）
  if (costTracker && response.model && response.usage) {
    costTracker.recordUsage('Step2_SlugGeneration', response.model, response.usage);
  }

  // Clean up response (remove any extra whitespace or formatting)
  const slug = response.content.trim().toLowerCase();

  // Check for UNKNOWN response (AI couldn't determine official English title)
  if (slug === 'unknown') {
    console.log(`[Slug Generator] ⚠️ AI returned UNKNOWN for "${japaneseText}" - will try fallback`);
    throw new Error(`AI could not determine official English title for "${japaneseText}"`);
  }

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
 * @param costTracker - Optional cost tracker for recording API usage
 * @returns Generated slug
 * @throws Error if all fallback methods fail
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithFallback("作品名", "anime title");
 * console.log(slug); // "work-slug" (from AI API)
 * ```
 */
export async function generateSlugWithFallback(
  japaneseText: string,
  context?: string,
  costTracker?: CostTrackerService
): Promise<string> {
  // Try AI API first (multi-provider support)
  try {
    console.log(
      `[Slug Generator] Trying AI API for: "${japaneseText}"${context ? ` (${context})` : ''}`
    );
    const aiSlug = await generateSlugWithAI(japaneseText, context, costTracker);
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
