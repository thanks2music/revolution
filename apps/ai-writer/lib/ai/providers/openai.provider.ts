/**
 * OpenAI AI Provider Implementation
 *
 * Purpose:
 *   - Implement AiProvider interface using OpenAI API
 *   - Cost-effective alternative with GPT-4.1-nano
 *   - Support for GPT-4 series models (Chat Completions API)
 *
 * @module lib/ai/providers/openai.provider
 * @see https://platform.openai.com/docs/api-reference
 */

import OpenAI from 'openai';
import type {
  AiProvider,
  ArticleGenerationRequest,
  GeneratedArticle,
  RssExtractionInput,
  RssExtractionResult,
  SendMessageOptions,
  SendMessageResult,
} from './ai-provider.interface';

/**
 * Recommended OpenAI models for different use cases
 *
 * Pricing (as of 2025-12, Standard tier per 1M tokens):
 * - gpt-4.1-nano: $0.10 input / $0.40 output (DEFAULT - best cost-performance)
 * - gpt-4o-mini: $0.15 input / $0.60 output
 * - gpt-4.1-mini: $0.40 input / $1.60 output
 * - gpt-4o: $2.50 input / $10.00 output
 *
 * Priority order for cost optimization:
 * 1. gpt-4.1-nano (most cost-effective for simple tasks)
 * 2. gpt-4o-mini (fallback)
 * 3. gpt-4.1-mini (higher capability)
 *
 * Note: GPT-5 series (gpt-5-nano, gpt-5-mini, gpt-5.x) requires
 * Responses API and different parameters. See REFACTORING.md for details.
 */
const OPENAI_MODELS = {
  // Priority 1: Most cost-effective (GPT-4.1 nano)
  GPT41_NANO: 'gpt-4.1-nano',
  // Priority 2: Fallback
  GPT4O_MINI: 'gpt-4o-mini',
  // Priority 3: Higher capability
  GPT41_MINI: 'gpt-4.1-mini',
  // High quality balanced option
  GPT4O: 'gpt-4o',
  // Premium quality option
  TURBO: 'gpt-4-turbo',
} as const;

/** Default model - using GPT-4.1-mini for better instruction following */
const DEFAULT_MODEL = OPENAI_MODELS.GPT41_MINI;

/**
 * OpenAI Provider
 *
 * @description
 * Implements the AiProvider interface using OpenAI Chat Completions API.
 * Uses gpt-4.1-nano by default for best cost efficiency.
 *
 * Pricing (as of 2025-12, Standard tier per 1M tokens):
 * - gpt-4.1-nano: $0.10 input / $0.40 output (DEFAULT)
 * - gpt-4o-mini: $0.15 input / $0.60 output
 *
 * @example
 * ```typescript
 * const provider = new OpenAIProvider();
 * const article = await provider.generateArticle({
 *   title: "Sample Article",
 *   sourceContent: "Content here...",
 * });
 * ```
 */
export class OpenAIProvider implements AiProvider {
  private client: OpenAI;
  private modelName: string;
  private apiKey: string;

  /**
   * Initialize OpenAI Provider
   *
   * @param apiKey - Optional API key override (defaults to OPENAI_API_KEY env var)
   * @param modelName - Optional model override (defaults to gpt-4.1-nano)
   */
  constructor(apiKey?: string, modelName: string = DEFAULT_MODEL) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is required. ' +
          'Set OPENAI_API_KEY environment variable or pass it as parameter to the constructor.'
      );
    }

    this.client = new OpenAI({ apiKey: this.apiKey });
    this.modelName = modelName;

    console.log(`🤖 OpenAI Provider initialized with model: ${modelName}`);
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
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      return this.parseArticleResponse(responseText, request);
    } catch (error) {
      console.error('OpenAI API Error:', error);
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
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const rawSlug = completion.choices[0]?.message?.content?.trim().toLowerCase() || '';

      // Sanitize slug
      const sanitizedSlug = rawSlug
        .replace(/[^\w\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
        .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .replace(/-{2,}/g, '-'); // Collapse multiple hyphens

      if (!sanitizedSlug || sanitizedSlug.length === 0) {
        console.warn(`⚠️ OpenAI returned empty slug for: ${title}`);
        return this.generateFallbackSlug(title);
      }

      return sanitizedSlug;
    } catch (error) {
      console.error('Failed to generate slug with OpenAI:', error);
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
    console.log(`🤖 Using AI Provider: OpenAI (${this.modelName})`);

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

    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      const result = this.parseRssExtractionResponse(responseText);

      // usage をコスト追跡用に追加
      return {
        ...result,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      console.error('OpenAI RSS extraction error:', error);
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
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Failed to generate excerpt with OpenAI:', error);
      throw new Error(
        `Failed to generate excerpt: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Test connection to OpenAI API
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [
          { role: 'user', content: 'Hello, please respond with "API connection successful"' },
        ],
        temperature: 0,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      return responseText.includes('API connection successful');
    } catch (error) {
      console.error('OpenAI API connection test failed:', error);
      return false;
    }
  }

  /**
   * Build article generation prompt
   *
   * @param request - Article generation request
   * @returns Formatted prompt for OpenAI
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
   * Parse OpenAI's response and extract article data
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
        console.error('OpenAI response that could not be parsed:', response);
        throw new Error('No JSON found in OpenAI response');
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
          model: this.modelName,
        },
      };
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error);
      throw new Error(
        `Failed to parse article response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Parse RSS extraction response from OpenAI
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
        model: this.modelName,
        confidence,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse extraction response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate fallback slug when OpenAI fails
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
   * Send a generic message to OpenAI API
   *
   * @description
   * Generic method for sending prompts to OpenAI.
   * Service layer handles prompt construction and response parsing.
   *
   * @param prompt - The prompt to send
   * @param options - Optional configuration
   * @returns Response with content and metadata
   */
  async sendMessage(prompt: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    console.log(`🤖 Using AI Provider: OpenAI (${this.modelName})`);

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      // Add system message if provided
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }

      // Add user message
      messages.push({ role: 'user', content: prompt });

      // Build API request options
      const createOptions: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: this.modelName,
        messages,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0,
      };

      // Enable JSON mode when responseFormat is 'json'
      // This ensures the model outputs valid, parseable JSON
      if (options?.responseFormat === 'json') {
        createOptions.response_format = { type: 'json_object' };
      }

      const completion = await this.client.chat.completions.create(createOptions);

      const responseText = completion.choices[0]?.message?.content || '';

      return {
        content: responseText,
        model: this.modelName,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      console.error('OpenAI sendMessage error:', error);
      throw new Error(
        `Failed to send message to OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
