/**
 * Article Metadata Generator Module
 *
 * Purpose:
 *   - Generate article excerpt using AI API
 *   - Support Phase 0.1 MVP article generation
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 *
 * taxonomy.yaml v1.1 対応（2025-12-17）
 * categories は buildCategories() で決定論的に生成するため、AI 生成から除外
 * @see lib/utils/category-builder.ts
 * @see notes/01-project-docs/05-ai-writer/mdx/AI-Writer-Deterministic-Category-Generation.md
 *
 * @module lib/claude/metadata-generator
 */

import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { GenerateMetadataInput, ArticleMetadata, AiMetadataResponse } from './types';
import { METADATA_DEFAULTS } from './types';

/**
 * Generate article excerpt using AI API
 *
 * @description
 * taxonomy.yaml v1.1 以降、categories は buildCategories() で決定論的に生成するため、
 * この関数は excerpt のみを生成します。
 *
 * @param {GenerateMetadataInput} input - Metadata generation parameters
 * @param {string} _apiKey - Deprecated: API key is now managed by AI provider factory
 * @returns {Promise<ArticleMetadata>} Generated metadata (excerpt only)
 *
 * @throws {Error} If AI API request fails
 * @throws {Error} If response parsing fails
 *
 * @example
 * ```typescript
 * const metadata = await generateArticleMetadata({
 *   content: "## イベント概要\n\n作品名と店舗名のコラボイベント概要...",
 *   title: "作品名×店舗名2025が東京で開催",
 *   workTitle: "作品名",
 *   eventType: "コラボカフェ"
 * });
 *
 * console.log(metadata.excerpt);    // "作品名と店舗名のコラボイベントが..."
 *
 * // categories は buildCategories() で別途生成
 * import { buildCategories } from '@/lib/utils/category-builder';
 * const categories = buildCategories({ workTitle: "作品名", eventTitle: "コラボカフェ" });
 * ```
 */
export async function generateArticleMetadata(
  input: GenerateMetadataInput,
  _apiKey?: string // Deprecated: kept for backward compatibility
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

  // Initialize AI provider (multi-provider support)
  const aiProvider = createAiProvider();

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
    // AI Provider経由でAPI呼び出し（マルチプロバイダー対応）
    const response = await aiProvider.sendMessage(prompt, {
      maxTokens: METADATA_DEFAULTS.MAX_TOKENS,
      temperature: METADATA_DEFAULTS.TEMPERATURE,
      responseFormat: 'json',
    });

    // Parse JSON response
    const metadata = parseMetadataResponse(response.content);

    // Validate generated metadata
    validateMetadata(metadata, { maxCategories, maxExcerptLength });

    // model/usage をコスト追跡用に追加
    return {
      ...metadata,
      model: response.model,
      usage: response.usage,
    };
  } catch (error) {
    console.error('AI API metadata generation error:', error);
    throw new Error(
      `Failed to generate article metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Build prompt for AI API excerpt generation
 *
 * @internal
 * @description
 * taxonomy.yaml v1.1 以降、categories は buildCategories() で決定論的に生成するため、
 * このプロンプトは excerpt のみを生成します。
 */
function buildMetadataPrompt(params: {
  content: string;
  title: string;
  workTitle: string;
  eventType: string;
  maxExcerptLength: number;
  maxCategories: number; // kept for backward compatibility, not used
}): string {
  const { content, title, workTitle, eventType, maxExcerptLength } = params;

  return `あなたは日本語記事の要約生成を専門とするアシスタントです。

以下の記事から、SEO向けの要約（excerpt）を生成してください。

## 記事タイトル
${title}

## 作品タイトル
${workTitle}

## イベントタイプ
${eventType}

## 記事内容
${content}

## 生成要件

### 要約（excerpt）
- ${maxExcerptLength}文字以内で簡潔な要約を作成してください
- SEOを意識した魅力的な要約にしてください
- 記事の最も重要な情報を含めてください
- 日本語で出力してください

## 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "excerpt": "記事の要約文（${maxExcerptLength}文字以内）"
}

## 重要な注意事項
- 日本語全角記号の引用符 " " ' ' 〝 〟 ゛ ❝ ❞ は禁止です。
- 半角英数のシングルクォート = ' も禁止です。
- 半角英数のダブルクォート = " も禁止です。
- クォート（' や "）ではなく、かぎ括弧「」を使用してください。強調・目立たせたい箇所には日本語のかぎ括弧「」で囲んでください。`;
}

/**
 * Parse AI API response to metadata
 *
 * @internal
 * @description
 * taxonomy.yaml v1.1 以降、categories は AI 生成から除外されたため、
 * excerpt のみを必須フィールドとして検証します。
 */
function parseMetadataResponse(response: string): ArticleMetadata {
  try {
    let metadataData: AiMetadataResponse;

    // [DEBUG] Log full response details
    console.log('[DEBUG] Full AI response length:', response.length);
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
        console.error('AI response that could not be parsed:', response);
        throw new Error('No JSON found in AI response');
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

      try {
        metadataData = JSON.parse(extractedJson);
        console.log('[DEBUG] Extracted JSON parse succeeded');
      } catch (blockParseError) {
        console.error('[DEBUG] Parse error details:', blockParseError);
        console.error('[DEBUG] Original extracted JSON:', originalJson);
        console.error('[DEBUG] After cleaning:', extractedJson);
        throw new Error('Invalid JSON in AI response');
      }
    }

    // Validate required fields (excerpt only, categories is now optional)
    // Note: categories は buildCategories() で決定論的に生成するため、AI 生成から除外
    if (!metadataData.excerpt || typeof metadataData.excerpt !== 'string') {
      throw new Error('Missing or invalid excerpt in AI response');
    }

    return {
      // categories は AI が返しても無視（後方互換性のため undefined を設定しない）
      categories: metadataData.categories,
      excerpt: metadataData.excerpt.trim(),
    };
  } catch (error) {
    console.error('Failed to parse AI metadata response:', error);
    throw new Error(
      `Failed to parse metadata response: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate generated metadata
 *
 * @internal
 * @description
 * taxonomy.yaml v1.1 以降、categories は buildCategories() で決定論的に生成するため、
 * この関数では excerpt のみを検証します。
 */
function validateMetadata(
  metadata: ArticleMetadata,
  constraints: { maxCategories: number; maxExcerptLength: number }
): void {
  const { maxExcerptLength } = constraints;

  // Note: categories 検証は taxonomy.yaml v1.1 以降スキップ
  // categories は buildCategories() で決定論的に生成するため

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
