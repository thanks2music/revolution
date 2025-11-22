/**
 * RSS Extractor Module
 *
 * Purpose:
 *   - Extract workTitle, storeName, eventTypeName from RSS text using Claude API
 *   - Support MDX pipeline production flow (Phase 0.2)
 *
 * @module lib/claude/rss-extractor
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Section: MDXパイプライン本番運用のための実装漏れについて
 */

import Anthropic from '@anthropic-ai/sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

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
 * RSS extraction output
 */
export interface RssExtractionResult {
  /** Extracted work title (e.g., "呪術廻戦") */
  workTitle: string;
  /** Extracted store/brand name (e.g., "BOX cafe&space") */
  storeName: string;
  /** Extracted event type name (e.g., "コラボカフェ") */
  eventTypeName: string;
  /** Model used for extraction */
  model: string;
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Claude API key cache
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
 * Extract work/store/event information from RSS text using Claude API
 *
 * @param input - RSS text to extract from
 * @param apiKey - Optional override API key
 * @returns Extracted information
 *
 * @example
 * ```typescript
 * const result = await extractFromRss({
 *   title: "呪術廻戦×BOX cafe&space2025が開催",
 *   content: "今年も「渋谷事変」のコラボレーションカフェが開催決定..."
 * });
 *
 * console.log(result.workTitle); // "呪術廻戦"
 * console.log(result.storeName); // "BOX cafe&space"
 * console.log(result.eventTypeName); // "コラボカフェ"
 * ```
 */
export async function extractFromRss(
  input: RssExtractionInput,
  apiKey?: string
): Promise<RssExtractionResult> {
  const key = apiKey || (await getAnthropicApiKey());
  const client = new Anthropic({ apiKey: key });

  // Build extraction prompt
  const prompt = buildExtractionPrompt(input);

  // Call Claude API
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Parse response
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API');
  }

  const extracted = parseExtractionResponse(content.text);

  return {
    ...extracted,
    model: response.model,
    confidence: calculateConfidence(extracted),
  };
}

/**
 * Build extraction prompt for Claude API
 *
 * @param input - RSS extraction input
 * @returns Formatted prompt
 */
function buildExtractionPrompt(input: RssExtractionInput): string {
  return `あなたはアニメコラボイベントの情報抽出エキスパートです。

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
}

/**
 * Parse Claude API response and extract structured data
 *
 * @param responseText - Response text from Claude API
 * @returns Parsed extraction result
 */
function parseExtractionResponse(responseText: string): {
  workTitle: string;
  storeName: string;
  eventTypeName: string;
} {
  // Extract JSON from markdown code block if present
  const jsonMatch = responseText.match(/```json\s*\n([\s\S]*?)\n```/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  try {
    const parsed = JSON.parse(jsonText.trim());

    if (!parsed.workTitle || !parsed.storeName || !parsed.eventTypeName) {
      throw new Error('Missing required fields in extraction response');
    }

    return {
      workTitle: parsed.workTitle.trim(),
      storeName: parsed.storeName.trim(),
      eventTypeName: parsed.eventTypeName.trim(),
    };
  } catch (error) {
    throw new Error(
      `Failed to parse extraction response: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Calculate confidence score based on extraction result
 *
 * @param extracted - Extracted data
 * @returns Confidence score (0-1)
 */
function calculateConfidence(extracted: {
  workTitle: string;
  storeName: string;
  eventTypeName: string;
}): number {
  // Simple heuristic: longer strings = higher confidence
  const avgLength =
    (extracted.workTitle.length + extracted.storeName.length + extracted.eventTypeName.length) / 3;

  // Confidence score: 0.6 baseline + 0.4 * (avgLength / 20)
  // Max confidence: 1.0
  return Math.min(0.6 + 0.4 * (avgLength / 20), 1.0);
}
