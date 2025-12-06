/**
 * Slug Generator Module with Fallback Chain
 *
 * Purpose:
 *   - Generate URL-friendly slugs from Japanese text
 *   - Implement fallback chain: Claude API → ASCII slugify → error
 *   - Support MDX Pipeline production flow (Phase 0.2)
 *
 * @module lib/config/slug-generator
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Section: Step 7 YAML fallback
 */

import Anthropic from '@anthropic-ai/sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DEFAULT_CLAUDE_MODEL } from './claude-models';

/**
 * Claude API key cache (shared with rss-extractor)
 */
let cachedAnthropicKey: string | null = null;

/**
 * Get Anthropic API key from Secret Manager
 *
 * @param forceRefresh - Force refresh cache
 * @returns Anthropic API key
 */
async function getAnthropicApiKey(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedAnthropicKey) {
    return cachedAnthropicKey;
  }

  // Pattern 1: Environment variable (local development)
  if (process.env.ANTHROPIC_API_KEY) {
    cachedAnthropicKey = process.env.ANTHROPIC_API_KEY;
    return cachedAnthropicKey;
  }

  // Pattern 2: Secret Manager (Cloud Run production)
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 't4v-revo-prd';
  const secretName = `projects/${projectId}/secrets/ANTHROPIC_API_KEY/versions/latest`;

  const [version] = await client.accessSecretVersion({ name: secretName });
  const key = version.payload?.data?.toString();

  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is empty in Secret Manager');
  }

  cachedAnthropicKey = key;
  return key;
}

/**
 * Generate URL-friendly slug from Japanese text using Claude API
 *
 * @param japaneseText - Japanese text (e.g., "呪術廻戦", "BOX cafe&space")
 * @param context - Context hint for Claude (e.g., "anime title", "cafe name")
 * @returns URL-friendly slug (e.g., "jujutsu-kaisen", "box-cafe-and-space")
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithClaude("呪術廻戦", "anime title");
 * console.log(slug); // "jujutsu-kaisen"
 * ```
 */
export async function generateSlugWithClaude(
  japaneseText: string,
  context?: string
): Promise<string> {
  const key = await getAnthropicApiKey();
  const client = new Anthropic({ apiKey: key });

  // TODO: マルチプロバイダー対応 - 現在はClaude固定
  console.log(`🤖 Using AI Provider: Anthropic Claude (${DEFAULT_CLAUDE_MODEL})`);

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

  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 100,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API');
  }

  // Clean up response (remove any extra whitespace or formatting)
  const slug = content.text.trim().toLowerCase();

  // Validate slug format (alphanumeric + hyphens only)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Generated slug contains invalid characters: "${slug}"`);
  }

  return slug;
}

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
 * 1. Try Claude API for intelligent Japanese → Romaji conversion
 * 2. If Claude fails, use ASCII slugify
 * 3. If result is empty, throw error
 *
 * @param japaneseText - Japanese text to convert
 * @param context - Optional context for Claude
 * @returns Generated slug
 * @throws Error if all fallback methods fail
 *
 * @example
 * ```typescript
 * const slug = await generateSlugWithFallback("呪術廻戦", "anime title");
 * console.log(slug); // "jujutsu-kaisen" (from Claude)
 * ```
 */
export async function generateSlugWithFallback(
  japaneseText: string,
  context?: string
): Promise<string> {
  // Try Claude API first
  try {
    console.log(
      `[Slug Generator] Trying Claude API for: "${japaneseText}"${context ? ` (${context})` : ''}`
    );
    const claudeSlug = await generateSlugWithClaude(japaneseText, context);
    console.log(`[Slug Generator] ✅ Claude API generated: "${claudeSlug}"`);
    return claudeSlug;
  } catch (error) {
    console.warn(
      `[Slug Generator] ⚠️ Claude API failed for "${japaneseText}":`,
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
