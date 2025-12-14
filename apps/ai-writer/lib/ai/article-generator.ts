import Anthropic from '@anthropic-ai/sdk';
import { RssFeedItem } from '../rss/parser';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DEFAULT_CLAUDE_MODEL } from '../config/claude-models';

/**
 * 記事生成リクエスト
 */
export interface ArticleGenerationRequest {
  /** RSS記事データ */
  rssItem: RssFeedItem;
  /** フィードメタデータ */
  feedMeta?: {
    title: string;
    link?: string;
  };
}

/**
 * 記事生成結果
 */
export interface ArticleGenerationResult {
  /** 生成されたMarkdown記事（frontmatter含む） */
  markdown: string;
  /** 使用したモデル */
  model: string;
  /** トークン使用量 */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

let cachedAnthropicApiKey: string | null = null;

/**
 * Anthropic API KeyをSecret Managerから取得（キャッシュ）
 */
async function getAnthropicApiKey(): Promise<string> {
  if (cachedAnthropicApiKey) {
    return cachedAnthropicApiKey;
  }

  const client = new SecretManagerServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 't4v-revo-prd';
  const secretName = `projects/${projectId}/secrets/ANTHROPIC_API_KEY/versions/latest`;

  const [version] = await client.accessSecretVersion({ name: secretName });
  const key = version.payload?.data?.toString();

  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is empty in Secret Manager');
  }

  cachedAnthropicApiKey = key;
  return key;
}

/**
 * Claude APIで記事を生成
 *
 * @param request - 記事生成リクエスト
 * @returns 生成されたMarkdown記事
 */
export async function generateArticleWithClaude(
  request: ArticleGenerationRequest
): Promise<ArticleGenerationResult> {
  const apiKey = await getAnthropicApiKey();
  const client = new Anthropic({ apiKey });

  const { rssItem, feedMeta } = request;

  // プロンプト構築
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(rssItem, feedMeta);

  // Claude API呼び出し
  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 4096,
    temperature: 0.7,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  // Handle refusal stop reason (Claude 4.5+)
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused to generate article due to safety policies');
  }

  // レスポンス抽出
  const textContent = response.content.find(block => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude API returned no text content');
  }

  const markdown = textContent.text.trim();

  return {
    markdown,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/**
 * システムプロンプト構築
 */
function buildSystemPrompt(): string {
  return `あなたはプロフェッショナルなコンテンツライターです。
RSS記事を元に、読みやすく情報価値の高いブログ記事を作成してください。

## 出力形式

以下のフォーマットに従ってMarkdownで記事を生成してください：

\`\`\`markdown
---
id: {数値ID}
title: {記事タイトル}
slug: {URLスラッグ}
date: {ISO 8601形式の日時}
categories: ['category1', 'category2']
tags: ['tag1', 'tag2', 'tag3']
excerpt: {記事の要約（150-200文字）}
author: Revolution AI Writer
ogImage: {OGP画像URL（あれば）}
---

# {記事タイトル}

{本文}

---

**出典**: [{元記事タイトル}]({元記事URL})
\`\`\`

## 記事作成ガイドライン

1. **frontmatter**:
   - id: タイムスタンプベースの数値ID
   - slug: 小文字、ハイフン区切り（例: anime-collab-cafe-2025-opening）
   - categories: 最大2-3個（tech, anime, game, lifestyle等）
   - tags: 最大5個
   - excerpt: SEO最適化された要約

2. **本文**:
   - 元記事の情報を正確に伝える
   - 見出し（##, ###）で構造化
   - 箇条書き・表を活用して読みやすく
   - 重要な情報を強調（**太字**）

3. **注意事項**:
   - 元記事の著作権を尊重
   - 虚偽の情報を追加しない
   - 出典を明記`;
}

/**
 * ユーザープロンプト構築
 */
function buildUserPrompt(
  rssItem: RssFeedItem,
  feedMeta?: { title: string; link?: string }
): string {
  const parts: string[] = [];

  parts.push('以下のRSS記事を元に、ブログ記事を作成してください。\n');

  if (feedMeta) {
    parts.push(`## フィード情報`);
    parts.push(`- フィード名: ${feedMeta.title}`);
    if (feedMeta.link) {
      parts.push(`- サイトURL: ${feedMeta.link}`);
    }
    parts.push('');
  }

  parts.push(`## RSS記事情報`);
  parts.push(`- タイトル: ${rssItem.title}`);
  parts.push(`- URL: ${rssItem.link}`);

  if (rssItem.pubDate) {
    parts.push(`- 公開日: ${rssItem.pubDate}`);
  }

  if (rssItem.categories && rssItem.categories.length > 0) {
    parts.push(`- カテゴリ: ${rssItem.categories.join(', ')}`);
  }

  if (rssItem.creator) {
    parts.push(`- 著者: ${rssItem.creator}`);
  }

  parts.push('');

  if (rssItem.contentSnippet) {
    parts.push(`## 記事概要`);
    parts.push(rssItem.contentSnippet);
    parts.push('');
  }

  if (rssItem.content) {
    parts.push(`## 本文（HTML）`);
    parts.push('```html');
    parts.push(rssItem.content);
    parts.push('```');
    parts.push('');
  }

  parts.push(`上記の情報を元に、魅力的なブログ記事を作成してください。`);

  return parts.join('\n');
}
