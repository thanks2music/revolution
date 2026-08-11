/**
 * AI Provider Common Interface
 *
 * Purpose:
 *   - Abstract interface for multiple AI providers (Anthropic, Gemini, OpenAI)
 *   - Enable provider switching without changing consumer code
 *   - Support Strategy pattern implementation
 *
 * @module lib/ai/providers/ai-provider.interface
 */

import type { PipelineStepId } from '@/lib/services/pipeline-steps';

/**
 * Supported AI provider types
 *
 * @description
 * Identified by vendor name (not LLM product name) so that every provider
 * slot uses the same vocabulary: `anthropic` (Claude), `google` (Gemini),
 * `openai` (ChatGPT).
 */
export type AiProviderType = 'anthropic' | 'google' | 'openai';

/**
 * Article generation request
 */
export interface ArticleGenerationRequest {
  title: string;
  sourceUrl?: string;
  sourceContent?: string;
  keywords?: string[];
  targetLength?: number;
  tone?: 'professional' | 'casual' | 'technical' | 'friendly';
  language?: 'ja' | 'en';
}

/**
 * Generated article result
 */
export interface GeneratedArticle {
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  tags: string[];
  categories: string[];
  metadata: {
    sourceUrl?: string;
    generatedAt: string;
    wordCount: number;
    model: string;
  };
}

/**
 * RSS extraction input
 */
export interface RssExtractionInput {
  /** RSS item title */
  title: string;
  /** RSS item content/description */
  content: string;
  /** RSS item link (optional) */
  link?: string;
}

/**
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * RSS extraction result
 */
export interface RssExtractionResult {
  /** Extracted work title (e.g., "作品名") */
  workTitle: string;
  /** Extracted store/brand name (e.g., "店舗名") */
  storeName: string;
  /** Extracted event type name (e.g., "コラボカフェ") */
  eventTypeName: string;
  /** Model used for extraction */
  model: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}

/**
 * Options for sendMessage() method
 *
 * @description
 * Provides flexible configuration for generic AI message sending.
 * Used for rapid prototyping and experimentation with new AI features.
 */
export interface SendMessageOptions {
  /** Maximum tokens to generate (default: provider-specific) */
  maxTokens?: number;
  /** Temperature for response randomness (0-1, default: 0) */
  temperature?: number;
  /** System prompt to set context (optional) */
  systemPrompt?: string;
  /** Expected response format hint */
  responseFormat?: 'text' | 'json';
  /**
   * OpenAI Structured Outputs (strict mode) 用 JSON Schema。
   *
   * 指定時、OpenAI Provider は `response_format: { type: 'json_schema', json_schema: { ...,
   * strict: true } }` で LLM に schema 準拠を強制する。`responseFormat: 'json'` は fallback として
   * 維持され、現状は OpenAI Provider のみが本 field を honor する (Anthropic / Gemini は無視)。
   *
   * @see apps/ai-writer/lib/utils/zod-to-openai-schema.ts
   */
  responseSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  /**
   * 呼び出し元のパイプラインステップ。観測ログの粒度を決める。
   *
   * `sendMessage` は全 AI ステップが通る唯一の地点だが、provider 自身は「どのステップ
   * から呼ばれたか」を知らない。ここで受け取ることで、記録を provider 層 1 箇所に
   * まとめられる (8 サービスへの個別実装を避ける)。
   *
   * 省略した呼び出しは `'unknown'` として記録され、記録自体は失われない。
   *
   * @see lib/ai/observability/ai-call-recorder.ts
   */
  stepId?: PipelineStepId;
  /**
   * 観測ログのレコードへそのまま載せるステップ固有の付随情報。
   *
   * `detail-extraction` は「どの URL を使い、どの候補を使わなかったか」「入力 HTML の
   * ハッシュとバイト数」を入れる。この 4 つが 1 レコードに揃っていないと、
   * **候補に大阪ページがあったのに東京ページだけが下流に流れていた**ことに気づけない
   * (2026-08-11 の根本原因が 5 時間見つからなかった直接の理由)。
   *
   * 生成物ではなく「何を入力したか」を残す用途に限る。
   */
  recordContext?: Record<string, unknown>;
}

/**
 * Result from sendMessage() method
 */
export interface SendMessageResult {
  /** The generated text response */
  content: string;
  /**
   * こちらが **要求した** モデル名 (`this.modelName`)。
   *
   * ⚠️ API が実際に応答したモデルではない。実応答は `resolvedModel` を見ること。
   * 既存の consumer (cost-tracker 等) がこの値に依存しているため意味は変えない。
   */
  model: string;
  /** Token usage statistics (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  // ── 観測用メタデータ (Phase 3.5 A) ──────────────────────────────────
  // いずれも optional。provider によって取得できるものが異なるうえ、
  // 既存の呼び出し側 9 箇所を壊さないため。

  /**
   * API が応答で返した実モデル名 (例: `gpt-5.4-mini-2026-01-30`)。
   *
   * 要求名は日付なしの alias であることが多い。**alias の解決先が変わっても
   * 要求名だけ見ていると気づけない**ため、要求と応答を必ず並べて記録する。
   */
  resolvedModel?: string;
  /**
   * OpenAI の `system_fingerprint`。Anthropic / Gemini は同等の概念がなく `null`。
   *
   * ⚠️ **実測 (2026-08-11、`gpt-5.4-mini`) では OpenAI 自身が返さず全件 null だった。**
   * OpenAI 公式は `seed` を Deprecated としたうえで本値の監視を案内しているが、
   * 少なくとも現行の既定モデルでは供給されていない。**この値だけを当てにしない。**
   *
   * 「モデル基盤が変わったのか同一基盤での揺れか」を実際に切り分けられるのは
   * {@link resolvedModel} のほう (`gpt-5.4-mini` → `gpt-5.4-mini-2026-03-17` の
   * ように日付入りの実体が返る)。将来 OpenAI が供給を再開したときに備えて
   * 記録は続けるが、判定の主役は resolvedModel とする。
   */
  systemFingerprint?: string | null;
  /** OpenAI `finish_reason` / Anthropic `stop_reason`。`length` は出力が切れた合図 */
  finishReason?: string;
  /** API 呼び出しの所要時間 (ms) */
  latencyMs?: number;
  /** OpenAI `completion.id` 等。サポート問い合わせに使う */
  requestId?: string;
}

/**
 * Common interface for AI providers
 *
 * @description
 * All AI providers (Anthropic Claude, Google Gemini, OpenAI ChatGPT)
 * must implement this interface to ensure consistent behavior.
 *
 * @example
 * ```typescript
 * class AnthropicProvider implements AiProvider {
 *   async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
 *     // Implementation using Anthropic SDK
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface AiProvider {
  /**
   * Generate an article based on source content or topic
   *
   * @param request - Article generation request
   * @returns Generated article with metadata
   */
  generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle>;

  /**
   * Generate URL-friendly slug from text (typically Japanese)
   *
   * @param title - Text to convert to slug (e.g., "作品名")
   * @param context - Optional context hint (e.g., "anime title")
   * @returns URL-friendly slug (e.g., "sample-work")
   */
  generateSlug(title: string, context?: string): Promise<string>;

  /**
   * Extract work/store/event information from RSS text
   *
   * @param input - RSS text to extract from
   * @returns Extracted information with confidence score
   */
  extractFromRss(input: RssExtractionInput): Promise<RssExtractionResult>;

  /**
   * Generate article excerpt/summary
   *
   * @param content - Article content
   * @param maxLength - Maximum length of excerpt (default: 150)
   * @returns Generated excerpt
   */
  generateExcerpt(content: string, maxLength?: number): Promise<string>;

  /**
   * Test connection to AI provider API
   *
   * @returns True if connection successful
   */
  testConnection(): Promise<boolean>;

  /**
   * Send a generic message to the AI provider
   *
   * @description
   * Generic method for sending prompts to AI providers.
   * Designed for rapid prototyping and experimentation with new AI features.
   * Service layer handles prompt construction and response parsing.
   *
   * Use cases:
   * - Article selection evaluation (article-selection step)
   * - Metadata generation (metadata-generation step)
   * - Title generation (title-generation step)
   * - Slug generation (slug-generation step)
   * - Future AI features (image analysis, content verification, etc.)
   *
   * @param prompt - The prompt to send to the AI
   * @param options - Optional configuration for the request
   * @returns Response with content and metadata
   *
   * @example
   * ```typescript
   * const result = await provider.sendMessage(
   *   "Extract the anime title from: ...",
   *   { temperature: 0, responseFormat: 'json' }
   * );
   * const parsed = JSON.parse(result.content);
   * ```
   */
  sendMessage(prompt: string, options?: SendMessageOptions): Promise<SendMessageResult>;
}
