/**
 * Claude Metadata Generator Module
 *
 * Purpose:
 *   - Generate article metadata (categories + excerpt) using Claude API
 *   - Support Phase 0.1 MVP article generation
 *   - Efficient single-call generation for both metadata fields
 *
 * @module lib/claude/metadata-generator
 */

import { ClaudeAPIService } from '../services/claude-api.service';
import type { GenerateMetadataInput, ArticleMetadata, ClaudeMetadataResponse } from './types';
import { METADATA_DEFAULTS } from './types';

/**
 * Generate article metadata (categories + excerpt) using Claude API
 *
 * @param {GenerateMetadataInput} input - Metadata generation parameters
 * @param {string} apiKey - Optional API key (uses env var if not provided)
 * @returns {Promise<ArticleMetadata>} Generated metadata
 *
 * @throws {Error} If API key is missing
 * @throws {Error} If Claude API request fails
 * @throws {Error} If response parsing fails
 *
 * @example
 * ```typescript
 * const metadata = await generateArticleMetadata({
 *   content: "## イベント概要\n\n呪術廻戦とBOX cafe&spaceのコラボ...",
 *   title: "呪術廻戦×BOX cafe&space2025が東京で開催",
 *   workTitle: "呪術廻戦",
 *   eventType: "コラボカフェ"
 * });
 *
 * console.log(metadata.categories); // ['呪術廻戦', 'コラボカフェ']
 * console.log(metadata.excerpt);    // "呪術廻戦とBOX cafe&spaceのコラボイベントが..."
 * ```
 */
export async function generateArticleMetadata(
  input: GenerateMetadataInput,
  apiKey?: string
): Promise<ArticleMetadata> {
  const {
    content,
    title,
    workTitle,
    eventType,
    maxExcerptLength = METADATA_DEFAULTS.MAX_EXCERPT_LENGTH,
    maxCategories = METADATA_DEFAULTS.MAX_CATEGORIES,
  } = input;

  // Validation
  if (!content || content.trim().length === 0) {
    throw new Error('Content is required for metadata generation');
  }

  if (!title || title.trim().length === 0) {
    throw new Error('Title is required for metadata generation');
  }

  if (!workTitle || workTitle.trim().length === 0) {
    throw new Error('Work title is required for metadata generation');
  }

  if (!eventType || eventType.trim().length === 0) {
    throw new Error('Event type is required for metadata generation');
  }

  // Initialize Claude API service
  const claudeService = new ClaudeAPIService(apiKey);

  // Build prompt for metadata generation
  const prompt = buildMetadataPrompt({
    content,
    title,
    workTitle,
    eventType,
    maxExcerptLength,
    maxCategories,
  });

  try {
    // Call Claude API using internal client (accessing private property for now)
    // TODO: Refactor ClaudeAPIService to expose a generic message creation method
    // TODO: マルチプロバイダー対応 - 現在はClaude固定
    const client = (claudeService as any).client;
    const model = (claudeService as any).model;

    console.log(`🤖 Using AI Provider: Anthropic Claude (${model})`);
    const response = await client.messages.create({
      model: model,
      max_tokens: METADATA_DEFAULTS.MAX_TOKENS,
      temperature: METADATA_DEFAULTS.TEMPERATURE,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Handle refusal stop reason (Claude 4.5+)
    if (response.stop_reason === 'refusal') {
      throw new Error('Claude refused to generate metadata due to safety policies');
    }

    const responseContent = response.content[0];
    if (responseContent.type !== 'text') {
      throw new Error('Unexpected response type from Claude API');
    }

    // Parse JSON response
    const metadata = parseMetadataResponse(responseContent.text);

    // Validate generated metadata
    validateMetadata(metadata, { maxCategories, maxExcerptLength });

    return metadata;
  } catch (error) {
    console.error('Claude API metadata generation error:', error);
    throw new Error(
      `Failed to generate article metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Build prompt for Claude API metadata generation
 * @internal
 */
function buildMetadataPrompt(params: {
  content: string;
  title: string;
  workTitle: string;
  eventType: string;
  maxExcerptLength: number;
  maxCategories: number;
}): string {
  const { content, title, workTitle, eventType, maxExcerptLength, maxCategories } = params;

  return `あなたは日本語記事のメタデータ生成を専門とするアシスタントです。

以下の記事から、カテゴリとexcerpt（要約）を生成してください。

## 記事タイトル
${title}

## 作品タイトル
${workTitle}

## イベントタイプ
${eventType}

## 記事内容
${content}

## 生成要件

### カテゴリ（categories）
- ${METADATA_DEFAULTS.MIN_CATEGORIES}〜${maxCategories}個のカテゴリを生成してください
- 必ず「${workTitle}」をカテゴリに含めてください
- 必ず「${eventType}」をカテゴリに含めてください
- 日本語で出力してください
- 読者が興味を持ちやすいカテゴリを選んでください

### 要約（excerpt）
- ${maxExcerptLength}文字以内で簡潔な要約を作成してください
- SEOを意識した魅力的な要約にしてください
- 記事の最も重要な情報を含めてください
- 日本語で出力してください

## 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "categories": ["カテゴリ1", "カテゴリ2", "カテゴリ3"],
  "excerpt": "記事の要約文（${maxExcerptLength}文字以内）"
}

## 重要な注意事項
- 日本語全角記号の引用符 ” “ ’ ‘ 〝 〟 ゛ ❝ ❞ は禁止です。
- 半角英数のシングルクォート = ' も禁止です。
- 半角英数のダブルクォート = " も禁止です。
- クォート（' や "）ではなく、かぎ括弧「」を使用してください。強調・目立たせたい箇所には日本語のかぎ括弧「」で囲んでください。`;
}

/**
 * Parse Claude API response to metadata
 * @internal
 */
function parseMetadataResponse(response: string): ArticleMetadata {
  try {
    let metadataData: ClaudeMetadataResponse;

    // [DEBUG] Log full response details
    console.log('[DEBUG] Full Claude response length:', response.length);
    console.log('[DEBUG] First 500 chars:', response.substring(0, 500));
    console.log('[DEBUG] Last 500 chars:', response.substring(response.length - 500));

    // First, try to parse the response directly as JSON
    try {
      metadataData = JSON.parse(response.trim());
      console.log('[DEBUG] Direct JSON parse succeeded');
    } catch (directParseError) {
      console.log('[DEBUG] Direct JSON parse failed, trying markdown extraction');

      // If direct parsing fails, try to extract JSON from markdown code blocks
      const jsonMatch =
        response.match(/```json\n([\s\S]*?)\n```/) ||
        response.match(/```\n([\s\S]*?)\n```/) ||
        response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('Claude response that could not be parsed:', response);
        throw new Error('No JSON found in Claude response');
      }

      console.log(
        '[DEBUG] JSON extraction succeeded with pattern:',
        jsonMatch.input?.includes('```json')
          ? '```json'
          : jsonMatch.input?.includes('```')
            ? '```'
            : 'regex \\{[\\s\\S]*\\}'
      );
      console.log('[DEBUG] Extracted JSON length:', (jsonMatch[1] || jsonMatch[0]).length);
      console.log('[DEBUG] Extracted JSON:', jsonMatch[1] || jsonMatch[0]);

      try {
        // Clean up extracted JSON before parsing
        // Replace Japanese full-width quotation marks with escaped ASCII quotes
        let extractedJson = jsonMatch[1] || jsonMatch[0];
        const originalJson = extractedJson;

        extractedJson = extractedJson
          .replace(/\u201C/g, '\\"') // U+201C: LEFT DOUBLE QUOTATION MARK (")
          .replace(/\u201D/g, '\\"'); // U+201D: RIGHT DOUBLE QUOTATION MARK (")

        if (originalJson !== extractedJson) {
          console.log('[DEBUG] Cleaned full-width quotation marks in JSON');
          console.log('[DEBUG] Original JSON:', originalJson);
          console.log('[DEBUG] Cleaned JSON:', extractedJson);
        }

        metadataData = JSON.parse(extractedJson);
        console.log('[DEBUG] Extracted JSON parse succeeded');
      } catch (blockParseError) {
        console.error('[DEBUG] Parse error details:', blockParseError);
        console.error('[DEBUG] Original extracted JSON:', jsonMatch[1] || jsonMatch[0]);
        console.error('[DEBUG] After cleaning:', extractedJson);
        throw new Error('Invalid JSON in Claude response');
      }
    }

    // Validate required fields
    if (
      !metadataData.categories ||
      !Array.isArray(metadataData.categories) ||
      metadataData.categories.length === 0
    ) {
      throw new Error('Missing or invalid categories in Claude response');
    }

    if (!metadataData.excerpt || typeof metadataData.excerpt !== 'string') {
      throw new Error('Missing or invalid excerpt in Claude response');
    }

    return {
      categories: metadataData.categories,
      excerpt: metadataData.excerpt.trim(),
    };
  } catch (error) {
    console.error('Failed to parse Claude metadata response:', error);
    throw new Error(
      `Failed to parse metadata response: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate generated metadata
 * @internal
 */
function validateMetadata(
  metadata: ArticleMetadata,
  constraints: { maxCategories: number; maxExcerptLength: number }
): void {
  const { maxCategories, maxExcerptLength } = constraints;

  // Validate categories count
  if (metadata.categories.length < METADATA_DEFAULTS.MIN_CATEGORIES) {
    throw new Error(
      `Too few categories: expected at least ${METADATA_DEFAULTS.MIN_CATEGORIES}, got ${metadata.categories.length}`
    );
  }

  if (metadata.categories.length > maxCategories) {
    // Truncate categories if too many (non-fatal)
    console.warn(
      `Too many categories (${metadata.categories.length}), truncating to ${maxCategories}`
    );
    metadata.categories = metadata.categories.slice(0, maxCategories);
  }

  // Validate categories are non-empty strings
  for (const category of metadata.categories) {
    if (!category || typeof category !== 'string' || category.trim() === '') {
      throw new Error('Categories must be non-empty strings');
    }
  }

  // Validate excerpt length
  if (metadata.excerpt.length > maxExcerptLength) {
    // Truncate excerpt if too long (non-fatal)
    console.warn(
      `Excerpt too long (${metadata.excerpt.length} chars), truncating to ${maxExcerptLength}`
    );
    metadata.excerpt = metadata.excerpt.slice(0, maxExcerptLength).trim();

    // Clean up if truncation broke a word
    const lastSpace = metadata.excerpt.lastIndexOf(' ');
    if (lastSpace > maxExcerptLength * 0.8) {
      metadata.excerpt = metadata.excerpt.slice(0, lastSpace).trim() + '...';
    }
  }

  // Validate excerpt is non-empty
  if (!metadata.excerpt || metadata.excerpt.trim() === '') {
    throw new Error('Excerpt must be a non-empty string');
  }
}
