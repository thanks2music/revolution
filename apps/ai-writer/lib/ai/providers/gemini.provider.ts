/**
 * Google Gemini AI Provider Implementation
 *
 * Purpose:
 *   - Implement AiProvider interface using the Google GenAI SDK (`@google/genai`)
 *   - Cost-effective alternative to Anthropic Claude / OpenAI
 *
 * ⚠️ 旧 SDK `@google/generative-ai` からの移行 (2026-08-16):
 * 旧 SDK は公式が 2025-11-30 に deprecated とし、**`thinkingLevel` を渡す口を持たない**
 * (型定義を実測してフィールド 11 個に該当なしを確認)。Gemini 3.x は推論モデルで
 * thinking トークンが出力として課金されるため、制御できないままではコストが読めない。
 * よって `@google/genai` へ移行した。
 *
 * @module lib/ai/providers/gemini.provider
 * @see https://ai.google.dev/gemini-api/docs
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { GenerateContentConfig, GenerateContentResponse } from '@google/genai';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_THINKING_LEVEL,
  resolveMaxOutputTokens,
} from '@/lib/config/gemini-models';
import { isGeminiDeterministicError, readGeminiText } from '@/lib/ai/gemini-response';
import type {
  AiProvider,
  ArticleGenerationRequest,
  GeneratedArticle,
  RssExtractionInput,
  RssExtractionResult,
  SendMessageOptions,
  SendMessageResult,
  TokenUsage,
} from './ai-provider.interface';
import { recordAiCall } from '@/lib/ai/observability/ai-call-recorder';

/** `sendMessage` の `maxTokens` 既定値 (旧実装から据え置き) */
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/**
 * Google Gemini Provider
 *
 * @description
 * Implements the AiProvider interface using the Google GenAI SDK.
 * Uses {@link DEFAULT_GEMINI_MODEL} by default (see `lib/config/gemini-models.ts`
 * for the selection rationale and the current pricing / shutdown status).
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
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;

  /**
   * このインスタンスが呼ぶモデル名。
   *
   * **全メソッドがこの 1 つの値を使う。** 旧実装は `sendMessage` だけが
   * `GEMINI_MODELS.FLASH_LITE` で上書きしており、パイプラインの AI ステップの大半が
   * `sendMessage` を通るため「コンストラクタのモデル指定が実質無効」だった
   * (2026-08-16 に是正)。
   */
  private readonly modelName: string;

  /** このインスタンスが使う thinking の深さ。`AI_THINKING_LEVEL` 由来 */
  private readonly thinkingLevel: ThinkingLevel;

  /**
   * Initialize Gemini Provider
   *
   * @param apiKey - Optional API key override (defaults to GEMINI_API_KEY env var)
   * @param modelName - Optional model override (defaults to {@link DEFAULT_GEMINI_MODEL})
   * @param thinkingLevel - Optional thinking depth (defaults to {@link DEFAULT_GEMINI_THINKING_LEVEL})
   */
  constructor(
    apiKey?: string,
    modelName: string = DEFAULT_GEMINI_MODEL,
    thinkingLevel: ThinkingLevel = DEFAULT_GEMINI_THINKING_LEVEL
  ) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        'Gemini API key is required. ' +
          'Set GEMINI_API_KEY environment variable or pass it as parameter to the constructor.'
      );
    }

    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    this.modelName = modelName;
    this.thinkingLevel = thinkingLevel;

    console.log(
      `🤖 Gemini Provider initialized with model: ${modelName} (thinking: ${thinkingLevel})`
    );
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
      const response = await this.generate(prompt, { maxTokens: 8192 });
      return this.parseArticleResponse(this.readText(response), request);
    } catch (error) {
      console.error('Gemini API Error:', error);
      if (isGeminiDeterministicError(error)) throw error;
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
      const response = await this.generate(prompt, { maxTokens: 100 });
      const rawSlug = this.readText(response).trim().toLowerCase();

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
      // ⚠️ ここだけは `isGeminiDeterministicError` を素通しにしない (意図的)。
      // slug は決定論的なローマ字変換でローカルに作れるため、切り詰め・ブロックで
      // 失敗しても**記事生成を止める理由にならない**。他のメソッドは throw する。
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
    console.log(`🤖 Using AI Provider: Google Gemini (${this.modelName})`);

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
      const response = await this.generate(prompt, { maxTokens: 2048 });
      const text = this.readText(response);
      const parsedResult = this.parseRssExtractionResponse(text);
      const usage = this.toTokenUsage(response);

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'google',
        requestedModel: this.modelName,
        resolvedModel: response.modelVersion ?? this.modelName,
        systemFingerprint: null,
        finishReason: response.candidates?.[0]?.finishReason,
        latencyMs: Date.now() - startedAt,
        prompt,
        responseText: text,
        usage,
      });

      // usage をコスト追跡用に追加
      return { ...parsedResult, usage };
    } catch (error) {
      console.error('Gemini RSS extraction error:', error);

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'google',
        requestedModel: this.modelName,
        latencyMs: Date.now() - startedAt,
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isGeminiDeterministicError(error)) throw error;
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
      const response = await this.generate(prompt, { maxTokens: 1024 });
      return this.readText(response).trim();
    } catch (error) {
      console.error('Failed to generate excerpt with Gemini:', error);
      if (isGeminiDeterministicError(error)) throw error;
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
      const response = await this.generate(
        'Hello, please respond with "API connection successful"',
        { maxTokens: 256 }
      );
      return this.readText(response).includes('API connection successful');
    } catch (error) {
      console.error('Gemini API connection test failed:', error);
      return false;
    }
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
    console.log(`🤖 Using AI Provider: Google Gemini (${this.modelName})`);

    const stepId = options?.stepId ?? 'unknown';
    const temperature = options?.temperature ?? 0;
    const startedAt = Date.now();

    try {
      const response = await this.generate(prompt, options);
      const text = this.readText(response);

      const usage = this.toTokenUsage(response);
      const latencyMs = Date.now() - startedAt;
      const finishReason = response.candidates?.[0]?.finishReason;
      const resolvedModel = response.modelVersion ?? this.modelName;

      await recordAiCall({
        stepId,
        context: options?.recordContext,
        provider: 'google',
        requestedModel: this.modelName,
        resolvedModel,
        // Gemini に `system_fingerprint` 相当の概念はない (null = 非対応)。
        systemFingerprint: null,
        finishReason,
        latencyMs,
        temperature,
        prompt,
        responseText: text,
        usage,
      });

      return {
        content: text,
        model: this.modelName,
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
        requestedModel: this.modelName,
        latencyMs: Date.now() - startedAt,
        temperature,
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isGeminiDeterministicError(error)) throw error;
      throw new Error(
        `Failed to send message to Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 内部ヘルパ
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Gemini API を 1 回呼ぶ (全メソッドの唯一の出口)
   *
   * モデル名・thinking・余裕枠の適用をここ 1 箇所に閉じることで、
   * 「あるメソッドだけ別のモデルを呼ぶ」類の食い違いが再発しないようにする。
   */
  private async generate(
    prompt: string,
    options?: SendMessageOptions
  ): Promise<GenerateContentResponse> {
    return this.client.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: this.buildRequestConfig(options),
    });
  }

  /**
   * `SendMessageOptions` を SDK の設定へ変換する
   *
   * - `maxTokens` には {@link THINKING_HEADROOM_TOKENS} を上乗せする (切り詰め防止)
   * - `responseSchema` があれば `responseJsonSchema` として渡し、スキーマ準拠を強制する
   *   (旧実装は JSON mode 止まりで、キー欠落が下流の誤診断を招いていた)
   */
  private buildRequestConfig(options?: SendMessageOptions): GenerateContentConfig {
    const requestedMaxTokens = options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const wantsJson =
      options?.responseFormat === 'json' || options?.responseSchema !== undefined;

    return {
      maxOutputTokens: resolveMaxOutputTokens(requestedMaxTokens, this.thinkingLevel),
      temperature: options?.temperature ?? 0,
      thinkingConfig: { thinkingLevel: this.thinkingLevel },
      ...(options?.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
      ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
      // `responseSchema` (interface 側の命名は OpenAI 由来) は JSON Schema なので
      // SDK の `responseJsonSchema` に対応する。`name` は Gemini 側では使わない。
      ...(options?.responseSchema
        ? { responseJsonSchema: options.responseSchema.schema }
        : {}),
    };
  }

  /**
   * 応答本文を取り出す。**異常終了した応答を正常な結果として返さない**
   *
   * 判定は {@link readGeminiText} に集約している (Vision 側と同じ実装を使うため)。
   */
  private readText(response: GenerateContentResponse): string {
    return readGeminiText(response, {
      label: 'GeminiProvider',
      modelName: this.modelName,
      thinkingLevel: this.thinkingLevel,
      thinkingEnvName: 'AI_THINKING_LEVEL',
    });
  }

  /**
   * `usageMetadata` を共通の {@link TokenUsage} へ変換する
   *
   * 🔴 **thinking トークンは出力として課金される**ため `completionTokens` に合算する。
   * 公式の `usageMetadata` は `candidatesTokenCount` と `thoughtsTokenCount` を
   * 別建てで返し、`totalTokenCount` は両方を含む
   * (実測検算: prompt 13 + candidates 3 + thoughts 68 = total 84)。
   * 合算しないと cost-tracker が出力コストを過小計上する。
   */
  private toTokenUsage(response: GenerateContentResponse): TokenUsage | undefined {
    const usageMetadata = response.usageMetadata;
    if (!usageMetadata) {
      return undefined;
    }

    return {
      promptTokens: usageMetadata.promptTokenCount ?? 0,
      completionTokens:
        (usageMetadata.candidatesTokenCount ?? 0) + (usageMetadata.thoughtsTokenCount ?? 0),
      totalTokens: usageMetadata.totalTokenCount ?? 0,
    };
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
          model: this.modelName,
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
}
