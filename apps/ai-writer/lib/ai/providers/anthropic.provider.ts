/**
 * Anthropic AI Provider Implementation
 *
 * Purpose:
 *   - Implement AiProvider interface using Anthropic Claude API
 *   - Enable provider switching through Strategy pattern
 *   - Support unified multi-provider architecture
 *
 * @module lib/ai/providers/anthropic.provider
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { ClaudeAPIService } from '../../services/claude-api.service';
import { DEFAULT_CLAUDE_MODEL } from '../../config/claude-models';
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
 * Anthropic Claude Provider
 *
 * @description
 * Wraps the existing ClaudeAPIService to implement the AiProvider interface.
 * This allows seamless integration with the provider factory pattern while
 * maintaining compatibility with existing Claude-specific functionality.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider();
 * const article = await provider.generateArticle({
 *   title: "Sample Article",
 *   sourceContent: "Content here...",
 * });
 * ```
 */
export class AnthropicProvider implements AiProvider {
  private claudeService: ClaudeAPIService;
  private client: Anthropic;
  private modelName: string;
  private apiKey: string;

  /**
   * Initialize Anthropic Provider
   *
   * @param apiKey - Optional API key override (defaults to ANTHROPIC_API_KEY env var)
   * @param modelName - Optional model override (defaults to DEFAULT_CLAUDE_MODEL)
   */
  constructor(apiKey?: string, modelName: string = DEFAULT_CLAUDE_MODEL) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        'Anthropic API key is required. ' +
          'Set ANTHROPIC_API_KEY environment variable or pass it as parameter to the constructor.'
      );
    }

    this.client = new Anthropic({ apiKey: this.apiKey });
    this.modelName = modelName;
    this.claudeService = new ClaudeAPIService(this.apiKey);

    console.log(`🤖 Anthropic Provider initialized with model: ${modelName}`);
  }

  /**
   * Generate an article based on source content or topic
   *
   * @param request - Article generation request
   * @returns Generated article with metadata
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    return await this.claudeService.generateArticle(request);
  }

  /**
   * Generate URL-friendly slug from text (typically Japanese)
   *
   * @param title - Text to convert to slug (e.g., "作品名")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "sample-work")
   */
  async generateSlug(title: string, context?: string): Promise<string> {
    // ClaudeAPIService.generateSlug doesn't use context parameter
    // Future enhancement: pass context to Claude prompt for better results
    return await this.claudeService.generateSlug(title);
  }

  /**
   * Extract work/store/event information from RSS text
   *
   * @param input - RSS text to extract from
   * @returns Extracted information with confidence score
   */
  async extractFromRss(input: RssExtractionInput): Promise<RssExtractionResult> {
    console.log(`🤖 Using AI Provider: Anthropic Claude (${this.modelName})`);

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

    // 実送信値と記録値を 1 箇所に束ねる (openai.provider.ts の同メソッドと同じ理由)。
    const temperature = 0;

    try {
      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: 1024,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      });

      // Handle refusal stop reason (Claude 4.5+)
      if (response.stop_reason === 'refusal') {
        throw new Error('Claude refused to extract RSS information due to safety policies');
      }

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      const usage = response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined;

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'anthropic',
        requestedModel: this.modelName,
        resolvedModel: response.model,
        systemFingerprint: null,
        finishReason: response.stop_reason ?? undefined,
        latencyMs: Date.now() - startedAt,
        requestId: response.id,
        temperature,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        responseSha256: hashForAiCallRecord(content.text),
        responseChars: content.text.length,
        responseText: content.text,
        usage,
      });

      const result = this.parseRssExtractionResponse(content.text);

      // usage をコスト追跡用に追加
      return { ...result, usage };
    } catch (error) {
      console.error('Anthropic RSS extraction error:', error);

      await recordAiCall({
        stepId: 'rss-extraction',
        provider: 'anthropic',
        requestedModel: this.modelName,
        latencyMs: Date.now() - startedAt,
        temperature,
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
   * Parse RSS extraction response from Claude API
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
   * Generate article excerpt/summary
   *
   * @param content - Article content
   * @param maxLength - Maximum length of excerpt (default: 150)
   * @returns Generated excerpt
   */
  async generateExcerpt(content: string, maxLength: number = 150): Promise<string> {
    return await this.claudeService.generateExcerpt(content, maxLength);
  }

  /**
   * Test connection to Anthropic Claude API
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    return await this.claudeService.testConnection();
  }

  /**
   * Send a generic message to Claude API
   *
   * @description
   * Generic method for sending prompts to Claude.
   * Service layer handles prompt construction and response parsing.
   *
   * @param prompt - The prompt to send
   * @param options - Optional configuration
   * @returns Response with content and metadata
   */
  async sendMessage(prompt: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    console.log(`🤖 Using AI Provider: Anthropic Claude (${this.modelName})`);

    const stepId = options?.stepId ?? 'unknown';
    const temperature = options?.temperature ?? 0;
    const startedAt = Date.now();

    try {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: options?.maxTokens ?? 2048,
        temperature,
        system: options?.systemPrompt,
        messages,
      });

      // Handle refusal stop reason (Claude 4.5+)
      if (response.stop_reason === 'refusal') {
        throw new Error('Claude refused to process the request due to safety policies');
      }

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      const latencyMs = Date.now() - startedAt;
      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      await recordAiCall({
        stepId,
        context: options?.recordContext,
        provider: 'anthropic',
        requestedModel: this.modelName,
        resolvedModel: response.model,
        // Anthropic に `system_fingerprint` 相当の概念はない。値を持たないことを
        // null で明示しておかないと、比較ツール側で「未記録」と「非対応」を
        // 区別できない。
        systemFingerprint: null,
        finishReason: response.stop_reason ?? undefined,
        latencyMs,
        requestId: response.id,
        temperature,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        responseSha256: hashForAiCallRecord(content.text),
        responseChars: content.text.length,
        responseText: content.text,
        usage,
      });

      return {
        content: content.text,
        model: this.modelName,
        usage,
        resolvedModel: response.model,
        systemFingerprint: null,
        finishReason: response.stop_reason ?? undefined,
        latencyMs,
        requestId: response.id,
      };
    } catch (error) {
      console.error('Anthropic sendMessage error:', error);

      await recordAiCall({
        stepId,
        context: options?.recordContext,
        provider: 'anthropic',
        requestedModel: this.modelName,
        latencyMs: Date.now() - startedAt,
        temperature,
        prompt,
        promptSha256: hashForAiCallRecord(prompt),
        promptChars: prompt.length,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `Failed to send message to Claude: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
