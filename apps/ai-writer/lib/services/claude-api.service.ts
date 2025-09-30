import { Anthropic } from '@anthropic-ai/sdk';

// Types for article generation
export interface ArticleGenerationRequest {
  title: string;
  sourceUrl?: string;
  sourceContent?: string;
  keywords?: string[];
  targetLength?: number;
  tone?: 'professional' | 'casual' | 'technical' | 'friendly';
  language?: 'ja' | 'en';
}

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

export class ClaudeAPIService {
  private client: Anthropic;
  private model: string = 'claude-3-7-sonnet-20250219';

  constructor(apiKey?: string) {
    if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass it as parameter.');
    }

    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY!,
    });
  }

  /**
   * Generate an article based on source content or topic
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    const prompt = this.buildArticlePrompt(request);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      return this.parseArticleResponse(content.text, request);
    } catch (error) {
      console.error('Claude API Error:', error);
      throw new Error(`Failed to generate article: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Test connection to Claude API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: 'Hello, please respond with "API connection successful"'
          }
        ]
      });

      const content = response.content[0];
      return content.type === 'text' && content.text.includes('API connection successful');
    } catch (error) {
      console.error('Claude API connection test failed:', error);
      return false;
    }
  }

  /**
   * Generate article summary/excerpt
   */
  async generateExcerpt(content: string, maxLength: number = 150): Promise<string> {
    const prompt = `以下の記事内容から、${maxLength}文字以内で魅力的な要約を作成してください。SEOを意識した要約にしてください。

記事内容:
${content}

要約:`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.5,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const responseContent = response.content[0];
      if (responseContent.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      return responseContent.text.trim();
    } catch (error) {
      console.error('Failed to generate excerpt:', error);
      throw new Error(`Failed to generate excerpt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the prompt for article generation
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
        prompt += `\n\n## 参考情報
${request.sourceContent}`;
      }

      if (request.sourceUrl) {
        prompt += `\n\n## 参考URL
${request.sourceUrl}`;
      }

      if (request.keywords && request.keywords.length > 0) {
        prompt += `\n\n## 重要キーワード
${request.keywords.join(', ')}`;
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
        prompt += `\n\n## Source Content
${request.sourceContent}`;
      }

      if (request.sourceUrl) {
        prompt += `\n\n## Source URL
${request.sourceUrl}`;
      }

      if (request.keywords && request.keywords.length > 0) {
        prompt += `\n\n## Important Keywords
${request.keywords.join(', ')}`;
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
      case 'professional': return 'プロフェッショナルで信頼性の高い文体';
      case 'casual': return '親しみやすくカジュアルな文体';
      case 'technical': return '技術的で専門性の高い文体';
      case 'friendly': return 'フレンドリーで読みやすい文体';
      default: return 'プロフェッショナルで信頼性の高い文体';
    }
  }

  /**
   * Parse Claude's response and extract article data
   */
  private parseArticleResponse(response: string, request: ArticleGenerationRequest): GeneratedArticle {
    try {
      let articleData: any;

      // First, try to parse the response directly as JSON
      try {
        articleData = JSON.parse(response.trim());
      } catch (directParseError) {
        // If direct parsing fails, try to extract JSON from markdown code blocks
        const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/```\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('Claude response that could not be parsed:', response);
          throw new Error('No JSON found in Claude response');
        }

        try {
          articleData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (blockParseError) {
          console.error('Failed to parse extracted JSON:', jsonMatch[1] || jsonMatch[0]);
          throw new Error('Invalid JSON in Claude response');
        }
      }

      // Validate required fields
      if (!articleData.title || !articleData.content) {
        throw new Error('Missing required fields in generated article');
      }

      // Count words (approximate for Japanese)
      const wordCount = request.language === 'ja'
        ? articleData.content.replace(/<[^>]*>/g, '').length
        : articleData.content.replace(/<[^>]*>/g, '').split(/\s+/).length;

      return {
        title: articleData.title,
        content: articleData.content,
        excerpt: articleData.excerpt || '',
        slug: articleData.slug || this.generateSlug(articleData.title),
        tags: articleData.tags || [],
        categories: articleData.categories || [],
        metadata: {
          sourceUrl: request.sourceUrl,
          generatedAt: new Date().toISOString(),
          wordCount,
          model: this.model
        }
      };
    } catch (error) {
      console.error('Failed to parse Claude response:', error);
      throw new Error(`Failed to parse article response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate URL-friendly slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

export default ClaudeAPIService;