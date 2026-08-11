/**
 * Google Gemini AI Provider Implementation
 *
 * Purpose:
 *   - Implement AiProvider interface using Google Gemini API
 *   - Cost-effective alternative to Anthropic Claude
 *   - Support for Gemini 2.5 Flash-Lite (cheapest model with free tier)
 *
 * @module lib/ai/providers/gemini.provider
 * @see https://ai.google.dev/gemini-api/docs
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type {
  AiProvider,
  ArticleGenerationRequest,
  GeneratedArticle,
  RssExtractionInput,
  RssExtractionResult,
  SendMessageOptions,
  SendMessageResult,
} from './ai-provider.interface';
import { recordAiCall, hashForAiCallRecord } from '@/lib/ai/observability/ai-call-recorder';

/**
 * Recommended Gemini models for different use cases
 *
 * Deprecation Schedule (as of 2025):
 * - gemini-2.0-flash: Earliest February 2026 (~3 months)
 * - gemini-2.5-flash-lite: Earliest July 2026 (~8 months) ⭐ Longest lifecycle
 * - gemini-2.5-flash: Earliest June 2026 (~7 months)
 * - gemini-2.5-pro: Earliest June 2026 (~7 months)
 */
const GEMINI_MODELS = {
  // Stable and widely available model with free tier (Deprecation: Feb 2026)
  FLASH_2_0: 'gemini-2.0-flash',
  // Cheapest and longest-lived option - best for production (Deprecation: July 2026)
  FLASH_LITE: 'gemini-2.5-flash-lite',
  // Balanced option with free tier (Deprecation: June 2026)
  FLASH: 'gemini-2.5-flash',
  // High quality option with free tier (Deprecation: June 2026)
  PRO: 'gemini-2.5-pro',
} as const;

/**
 * Google Gemini Provider
 *
 * @description
 * Implements the AiProvider interface using Google Gemini API.
 * Uses Gemini 2.5 Flash-Lite by default for cost efficiency and longevity.
 *
 * Pricing (as of 2025):
 * - Gemini 2.5 Flash-Lite: $0.10 input / $0.40 output per 1M tokens (Free tier available)
 * - ~30x cheaper than Claude Sonnet 4.5
 * - Longest lifecycle among Flash models (Deprecation: July 2026)
 *
 * @example
 * ```typescript
 * const provider = new GeminiProvider();
 * const article = await provider.generateArticle({
 *   title: "Sample Article",
 *   sourceContent: "Content here...",
 * });
 * ```
 */
export class GeminiProvider implements AiProvider {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private apiKey: string;
  /**
   * `this.model` を組み立てたときのモデル名。
   *
   * ⚠️ 観測ログの `requestedModel` を実際に呼ぶモデルと一致させるためだけに保持する。
   * `sendMessage` は `this.model` を使わず `GEMINI_MODELS.FLASH_LITE` で別のモデルを
   * 組み立て直すため、本フィールドは `this.model` を使う経路 (`generateArticle` /
   * `extractFromRss` 等) にのみ対応する。この不一致自体の是正は別タスク
   * (Todoist「Gemini モデルを現行世代へ更新する」) で扱う。
   */
  private readonly configuredModelName: string;

  /**
   * Initialize Gemini Provider
   *
   * @param apiKey - Optional API key override (defaults to GEMINI_API_KEY env var)
   * @param modelName - Optional model override (defaults to gemini-2.5-flash-lite)
   */
  constructor(apiKey?: string, modelName: string = GEMINI_MODELS.FLASH_LITE) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        'Gemini API key is required. ' +
          'Set GEMINI_API_KEY environment variable or pass it as parameter to the constructor.'
      );
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.configuredModelName = modelName;

    console.log(`🤖 Gemini Provider initialized with model: ${modelName}`);
  }

  /**
   * Generate an article based on source content or topic
   *
   * @param request - Article generation request
   * @returns Generated article with metadata
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    const prompt = this.buildArticlePrompt(request);

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      return this.parseArticleResponse(text, request);
    } catch (error) {
      console.error('Gemini API Error:', error);
      throw new Error(
        `Failed to generate article: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate URL-friendly slug from text (typically Japanese)
   *
   * @param title - Text to convert to slug (e.g., "作品名")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "sample-work")
   */
  async generateSlug(title: string, context?: string): Promise<string> {
    const prompt = `Convert the following Japanese title to a URL-friendly slug (lowercase alphanumeric characters and hyphens only).

Title: ${title}
${context ? `Context: ${context}` : ''}

Requirements:
- Use English transliteration or common English title if available
- If no English title exists, use Romaji
- All lowercase, words separated by hyphens
- Remove special characters
- Keep it simple and memorable

Output format: Return ONLY the slug, nothing else. Do NOT include markdown formatting, code blocks, or explanations.

Examples:
 - 呪術廻戦 → jujutsu-kaisen
 - チェンソーマン → chainsaw-man
 - 鬼滅の刃 → kimetsu-no-yaiba
 - ハイキュー!! → haikyu

Slug:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const rawSlug = response.text().trim().toLowerCase();

      // Sanitize slug
      const sanitizedSlug = rawSlug
        .replace(/[^\w\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
        .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .replace(/-{2,}/g, '-'); // Collapse multiple hyphens

      if (!sanitizedSlug || sanitizedSlug.length === 0) {
        console.warn(`⚠️ Gemini returned empty slug for: ${title}`);
        return this.generateFallbackSlug(title);
      }

      return sanitizedSlug;
    } catch (error) {
      console.error('Failed to generate slug with Gemini:', error);
      return this.generateFallbackSlug(title);
    }
  }

  /**
   * Extract work/store/event information from RSS text
   *
   * @param input - RSS text to extract from
   * @returns Extracted information with confidence score
   */
  async extractFromRss(input: RssExtractionInput): Promise<RssExtractionResult> {
    console.log(`🤖 Using AI Provider: Google Gemini (${this.configuredModelName})`);

    const prompt = `あなたはアニメコラボイベントの情報抽出エキスパートです。

以下のRSS記事から、以下の3つの情報を抽出してください：

1. **作品名 (workTitle)**: コラボレーション対象のアニメ・マンガ作品名
2. **店舗名 (storeName)**: コラボを実施する店舗・ブランド名
3. **イベントタイプ (eventTypeName)**: イベントの種類（例: "コラボカフェ", "グッズ販売", "ポップアップストア"）

## RSS記事

**タイトル**: ${input.title}

**本文**:
${input.content}

${input.link ? `**URL**: ${input.link}` : ''}

## 抽出ルール

- 作品名は正式名称を使用（略称ではなく完全な名前）
- 店舗名はブランド名を含む正式名称を使用
- イベントタイプは「コラボカフェ」「ポップアップストア」「グッズ販売」などの一般的なカテゴリ名
- 情報が明示的に記載されていない場合は、文脈から推測してください
- 複数の作品がある場合は、最も重要な作品を選択してください

## 出力形式

以下のJSON形式で出力してください：

\`\`\`json
{
  "workTitle": "作品名",
  "storeName": "店舗名",
  "eventTypeName": "イベントタイプ"
}
\`\`\`

JSON以外の説明文は出力しないでください。`;

    // ★ `extractFromRss` は `sendMessage` を経由しない独自実装のため、記録も個別に要る
    //   (openai.provider.ts の同メソッドと同じ理由)。
    const startedAt = Date.now();

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const parsedResult = this.parseRssExtractionResponse(text);

      // Extract usage metadata if available
      const usageMetadata = response.usageMetadata;
      const rssUsage = usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount ?? 0,
            completionTokens: usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: usageMetadata.totalTokenCount ?? 0,
          }
        : undefined;

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'google',
        // `this.model` は constructor の modelName で組み立てられているため、
        // FLASH_LITE 固定で書くと呼んでいないモデル名を記録することになる。
        requestedModel: this.configuredModelName,
        resolvedModel:
          (response as { modelVersion?: string }).modelVersion ?? this.configuredModelName,
        systemFingerprint: null,
        finishReason: response.candidates?.[0]?.finishReason,
        latencyMs: Date.now() - startedAt,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        responseSha256: hashForAiCallRecord(text),
        responseChars: text.length,
        responseText: text,
        usage: rssUsage,
      });

      // usage をコスト追跡用に追加
      return {
        ...parsedResult,
        usage: usageMetadata
          ? {
              promptTokens: usageMetadata.promptTokenCount ?? 0,
              completionTokens: usageMetadata.candidatesTokenCount ?? 0,
              totalTokens: usageMetadata.totalTokenCount ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      console.error('Gemini RSS extraction error:', error);

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'google',
        requestedModel: this.configuredModelName,
        latencyMs: Date.now() - startedAt,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `Failed to extract RSS information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate article excerpt/summary
   *
   * @param content - Article content
   * @param maxLength - Maximum length of excerpt (default: 150)
   * @returns Generated excerpt
   */
  async generateExcerpt(content: string, maxLength: number = 150): Promise<string> {
    const prompt = `以下の記事内容から、${maxLength}文字以内で魅力的な要約を作成してください。SEOを意識した要約にしてください。

記事内容:
${content}

要約:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Failed to generate excerpt with Gemini:', error);
      throw new Error(
        `Failed to generate excerpt: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Test connection to Gemini API
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.model.generateContent(
        'Hello, please respond with "API connection successful"'
      );
      const response = result.response;
      const text = response.text();
      return text.includes('API connection successful');
    } catch (error) {
      console.error('Gemini API connection test failed:', error);
      return false;
    }
  }

  /**
   * Build article generation prompt
   *
   * @param request - Article generation request
   * @returns Formatted prompt for Gemini
   */
  private buildArticlePrompt(request: ArticleGenerationRequest): string {
    const language = request.language || 'ja';
    const tone = request.tone || 'professional';
    const targetLength = request.targetLength || 800;

    let prompt = '';

    if (language === 'ja') {
      prompt = `あなたは優秀な日本語ライターです。以下の要件に従って、高品質な記事を作成してください。

## 要件
- 言語: 日本語
- 文体: ${this.getToneDescription(tone)}
- 目標文字数: 約${targetLength}文字
- SEOを意識した構成
- 読みやすく情報価値の高い内容

## 記事のテーマ/タイトル
${request.title}`;

      if (request.sourceContent) {
        prompt += `\n\n## 参考情報\n${request.sourceContent}`;
      }

      if (request.sourceUrl) {
        prompt += `\n\n## 参考URL\n${request.sourceUrl}`;
      }

      if (request.keywords && request.keywords.length > 0) {
        prompt += `\n\n## 重要キーワード\n${request.keywords.join(', ')}`;
      }

      prompt += `\n\n## 重要な指示
必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "title": "記事タイトル",
  "content": "記事本文（HTML形式、見出しh2/h3、段落p、リストul/olを使用）",
  "excerpt": "記事の要約（150文字以内）",
  "slug": "url-friendly-slug",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "categories": ["カテゴリ1", "カテゴリ2"]
}`;
    } else {
      // English version
      prompt = `You are an expert English content writer. Create a high-quality article following these requirements:

## Requirements
- Language: English
- Tone: ${tone}
- Target length: approximately ${targetLength} words
- SEO-optimized structure
- Readable and informative content

## Article Topic/Title
${request.title}`;

      if (request.sourceContent) {
        prompt += `\n\n## Source Content\n${request.sourceContent}`;
      }

      if (request.sourceUrl) {
        prompt += `\n\n## Source URL\n${request.sourceUrl}`;
      }

      if (request.keywords && request.keywords.length > 0) {
        prompt += `\n\n## Important Keywords\n${request.keywords.join(', ')}`;
      }

      prompt += `\n\n## IMPORTANT INSTRUCTION
Respond ONLY with JSON format. No other text should be included.

{
  "title": "Article Title",
  "content": "Article content (HTML format with h2/h3 headings, p paragraphs, ul/ol lists)",
  "excerpt": "Article summary (under 150 characters)",
  "slug": "url-friendly-slug",
  "tags": ["tag1", "tag2", "tag3"],
  "categories": ["category1", "category2"]
}`;
    }

    return prompt;
  }

  /**
   * Get tone description in Japanese
   */
  private getToneDescription(tone: string): string {
    switch (tone) {
      case 'professional':
        return 'プロフェッショナルで信頼性の高い文体';
      case 'casual':
        return '親しみやすくカジュアルな文体';
      case 'technical':
        return '技術的で専門性の高い文体';
      case 'friendly':
        return 'フレンドリーで読みやすい文体';
      default:
        return 'プロフェッショナルで信頼性の高い文体';
    }
  }

  /**
   * Parse Gemini's response and extract article data
   */
  private parseArticleResponse(
    response: string,
    request: ArticleGenerationRequest
  ): GeneratedArticle {
    try {
      // Try to extract JSON from markdown code blocks or direct JSON
      const jsonMatch =
        response.match(/```json\n([\s\S]*?)\n```/) ||
        response.match(/```\n([\s\S]*?)\n```/) ||
        response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('Gemini response that could not be parsed:', response);
        throw new Error('No JSON found in Gemini response');
      }

      const articleData = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      // Validate required fields
      if (!articleData.title || !articleData.content) {
        throw new Error('Missing required fields in generated article');
      }

      // Count words (approximate for Japanese)
      const wordCount =
        request.language === 'ja'
          ? articleData.content.replace(/<[^>]*>/g, '').length
          : articleData.content.replace(/<[^>]*>/g, '').split(/\s+/).length;

      return {
        title: articleData.title,
        content: articleData.content,
        excerpt: articleData.excerpt || '',
        slug: articleData.slug || 'untitled',
        tags: articleData.tags || [],
        categories: articleData.categories || [],
        metadata: {
          sourceUrl: request.sourceUrl,
          generatedAt: new Date().toISOString(),
          wordCount,
          model: 'gemini-2.5-flash-lite',
        },
      };
    } catch (error) {
      console.error('Failed to parse Gemini response:', error);
      throw new Error(
        `Failed to parse article response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Parse RSS extraction response from Gemini
   */
  private parseRssExtractionResponse(responseText: string): RssExtractionResult {
    // Extract JSON from markdown code block if present
    const jsonMatch = responseText.match(/```json\s*\n([\s\S]*?)\n```/);
    const jsonText = jsonMatch ? jsonMatch[1] : responseText;

    try {
      const parsed = JSON.parse(jsonText.trim());

      if (!parsed.workTitle || !parsed.storeName || !parsed.eventTypeName) {
        throw new Error('Missing required fields in extraction response');
      }

      // Calculate confidence score (simple heuristic)
      const avgLength =
        (parsed.workTitle.length + parsed.storeName.length + parsed.eventTypeName.length) / 3;
      const confidence = Math.min(0.6 + 0.4 * (avgLength / 20), 1.0);

      return {
        workTitle: parsed.workTitle.trim(),
        storeName: parsed.storeName.trim(),
        eventTypeName: parsed.eventTypeName.trim(),
        model: 'gemini-2.5-flash-lite',
        confidence,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse extraction response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate fallback slug when Gemini fails
   */
  private generateFallbackSlug(title: string): string {
    const basicSlug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    if (basicSlug && basicSlug.length >= 2) {
      console.log(`📝 Using basic fallback slug: ${title} → ${basicSlug}`);
      return basicSlug;
    }

    const timestamp = Date.now().toString(36);
    const fallbackSlug = `article-${timestamp}`;
    console.warn(`⚠️ Generated timestamp-based fallback slug: ${title} → ${fallbackSlug}`);
    return fallbackSlug;
  }

  /**
   * Send a generic message to Gemini API
   *
   * @description
   * Generic method for sending prompts to Gemini.
   * Service layer handles prompt construction and response parsing.
   *
   * @param prompt - The prompt to send
   * @param options - Optional configuration
   * @returns Response with content and metadata
   */
  async sendMessage(prompt: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    const modelName = GEMINI_MODELS.FLASH_LITE;
    console.log(`🤖 Using AI Provider: Google Gemini (${modelName})`);

    const stepId = options?.stepId ?? 'unknown';
    const temperature = options?.temperature ?? 0;
    const startedAt = Date.now();

    try {
      // Create model with generation config
      const model = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? 2048,
          temperature,
          // Enable JSON mode when responseFormat is 'json'
          // This ensures the model outputs valid, parseable JSON
          responseMimeType:
            options?.responseFormat === 'json' ? 'application/json' : undefined,
        },
        systemInstruction: options?.systemPrompt,
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      // Extract usage metadata if available
      const usageMetadata = response.usageMetadata;
      const latencyMs = Date.now() - startedAt;

      const usage = usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount ?? 0,
            completionTokens: usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: usageMetadata.totalTokenCount ?? 0,
          }
        : undefined;
      const finishReason = response.candidates?.[0]?.finishReason;
      // `modelVersion` は API が返すが SDK の型に無い。要求名で握り潰さず、
      // 返ってきた場合だけ実モデル版として記録する。
      const resolvedModel =
        (response as { modelVersion?: string }).modelVersion ?? modelName;

      await recordAiCall({
        stepId,
        context: options?.recordContext,
        provider: 'google',
        requestedModel: modelName,
        resolvedModel,
        // Gemini に `system_fingerprint` 相当の概念はない (null = 非対応)。
        systemFingerprint: null,
        finishReason,
        latencyMs,
        temperature,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        responseSha256: hashForAiCallRecord(text),
        responseChars: text.length,
        responseText: text,
        usage,
      });

      return {
        content: text,
        model: modelName,
        usage,
        resolvedModel,
        systemFingerprint: null,
        finishReason,
        latencyMs,
      };
    } catch (error) {
      console.error('Gemini sendMessage error:', error);

      await recordAiCall({
        stepId,
        context: options?.recordContext,
        provider: 'google',
        requestedModel: modelName,
        latencyMs: Date.now() - startedAt,
        temperature,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `Failed to send message to Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
