import ClaudeAPIService, { ArticleGenerationRequest, GeneratedArticle } from './claude-api.service';
import { WordPressGraphQLService, PostStatus } from './wordpress-graphql.service';
import type { RssArticleEntry } from '../types/rss-article';

// Types for the article generation pipeline
export interface ArticleGenerationConfig {
  useClaudeAPI: boolean;
  wordPressEndpoint: string;
  wordPressAuthToken?: string;
  defaultStatus: PostStatus;
  defaultAuthorId?: string;
  defaultCategoryIds?: string[];
}

export interface ArticlePublishRequest {
  article: GeneratedArticle;
  status?: PostStatus;
  authorId?: string;
  categoryIds?: string[];
  publishDate?: string;
  featuredImageUrl?: string;
}

export interface ArticlePublishResult {
  success: boolean;
  postId?: string;
  databaseId?: number;
  postUrl?: string;
  error?: string;
  article: GeneratedArticle;
  wordPressCategories?: Array<{ id: string; name: string }>;
  wordPressTags?: Array<{ id: string; name: string }>;
}

export interface RSSArticleRequest {
  rssItem: {
    title: string;
    link: string;
    description?: string;
    content?: string;
    pubDate?: string;
    categories?: string[];
  };
  generationOptions?: Partial<ArticleGenerationRequest>;
  publishOptions?: Partial<ArticlePublishRequest>;
}

export class ArticleGenerationService {
  private claudeService: ClaudeAPIService;
  private wordPressService: WordPressGraphQLService;
  private config: ArticleGenerationConfig;

  constructor(config: ArticleGenerationConfig) {
    this.config = config;

    if (config.useClaudeAPI) {
      this.claudeService = new ClaudeAPIService();
    }

    this.wordPressService = new WordPressGraphQLService(
      config.wordPressEndpoint,
      config.wordPressAuthToken
    );
  }

  /**
   * Generate and publish an article from RSS item
   */
  async generateAndPublishFromRSS(request: RSSArticleRequest): Promise<ArticlePublishResult> {
    try {
      console.log(`Starting article generation from RSS: ${request.rssItem.title}`);

      // Step 1: Generate article using Claude API
      const generationRequest: ArticleGenerationRequest = {
        title: request.rssItem.title,
        sourceUrl: request.rssItem.link,
        sourceContent: request.rssItem.content || request.rssItem.description,
        keywords: request.rssItem.categories,
        ...request.generationOptions
      };

      const generatedArticle = await this.generateArticle(generationRequest);

      // Step 2: Publish to WordPress
      const publishRequest: ArticlePublishRequest = {
        article: generatedArticle,
        status: this.config.defaultStatus,
        authorId: this.config.defaultAuthorId,
        categoryIds: this.config.defaultCategoryIds,
        ...request.publishOptions
      };

      const publishResult = await this.publishToWordPress(publishRequest);

      console.log(`Article generation and publishing completed: ${publishResult.success ? 'SUCCESS' : 'FAILED'}`);

      return publishResult;

    } catch (error) {
      console.error('Failed to generate and publish article from RSS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: {} as GeneratedArticle
      };
    }
  }

  /**
   * Generate an article using Claude API
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    if (!this.config.useClaudeAPI) {
      throw new Error('Claude API is disabled in configuration');
    }

    try {
      console.log('Generating article with Claude API...');
      const article = await this.claudeService.generateArticle(request);
      console.log(`Article generated successfully: ${article.metadata.wordCount} characters`);
      return article;
    } catch (error) {
      console.error('Claude API article generation failed:', error);
      throw new Error(`Article generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Publish generated article to WordPress
   */
  async publishToWordPress(request: ArticlePublishRequest): Promise<ArticlePublishResult> {
    try {
      console.log('Publishing article to WordPress...');

      // Prepare categories (convert names to IDs if needed)
      const categoryIds = await this.prepareCategoryIds(request.article.categories, request.categoryIds);

      // Prepare tags (convert names to IDs if needed)
      const tagIds = await this.prepareTagIds(request.article.tags);

      // Create post in WordPress
      const post = await this.wordPressService.createPostExtended({
        title: request.article.title,
        content: request.article.content,
        slug: request.article.slug,
        excerpt: request.article.excerpt,
        status: request.status || this.config.defaultStatus,
        authorId: request.authorId || this.config.defaultAuthorId,
        categoryIds: categoryIds,
        tagIds: tagIds,
        date: request.publishDate,
        featuredImageUrl: request.featuredImageUrl
      });

      console.log(`Article published successfully to WordPress: ID ${post.databaseId}`);

      return {
        success: true,
        postId: post.id,
        databaseId: post.databaseId,
        postUrl: post.uri,
        article: request.article,
        wordPressCategories: post.categories?.nodes || [],
        wordPressTags: post.tags?.nodes || []
      };

    } catch (error) {
      console.error('WordPress publishing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: request.article
      };
    }
  }

  /**
   * Test connections to Claude API and WordPress
   */
  async testConnections(): Promise<{
    claude: boolean;
    wordpress: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let claudeStatus = false;
    let wordpressStatus = false;

    // Test Claude API
    if (this.config.useClaudeAPI) {
      try {
        claudeStatus = await this.claudeService.testConnection();
        if (!claudeStatus) {
          errors.push('Claude API connection test failed');
        }
      } catch (error) {
        errors.push(`Claude API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      claudeStatus = true; // Not required
    }

    // Test WordPress GraphQL
    try {
      wordpressStatus = await this.wordPressService.testConnection();
      if (!wordpressStatus) {
        errors.push('WordPress GraphQL connection test failed');
      }
    } catch (error) {
      errors.push(`WordPress GraphQL error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      claude: claudeStatus,
      wordpress: wordpressStatus,
      errors
    };
  }

  /**
   * Generate and publish article from RSS entry
   */
  async generateAndPublishFromRssEntry(
    rssEntry: RssArticleEntry,
    options?: {
      publishStatus?: PostStatus;
      authorId?: string;
      categoryIds?: string[];
      customTitle?: string;
      customKeywords?: string[];
    }
  ): Promise<ArticlePublishResult> {
    try {
      console.log(`Starting article generation from RSS entry: ${rssEntry.title}`);

      if (!rssEntry.link) {
        throw new Error('RSS entry must have a valid link');
      }

      // RSS記事の情報を使って記事生成リクエストを構築
      const generationOptions: Partial<ArticleGenerationRequest> = {
        title: options?.customTitle || rssEntry.title,
        keywords: options?.customKeywords || rssEntry.categories || [],
        targetLength: 600, // 記事として適切な長さ
        tone: 'friendly',
        language: 'ja'
      };

      // Claude APIでURLから記事内容を抽出して記事生成
      const generatedArticle = await this.claudeService.generateArticleFromURL(
        rssEntry.link,
        generationOptions
      );

      // WordPress投稿オプションを準備
      const publishRequest: ArticlePublishRequest = {
        article: generatedArticle,
        status: options?.publishStatus || this.config.defaultStatus,
        authorId: options?.authorId || this.config.defaultAuthorId,
        categoryIds: options?.categoryIds || this.config.defaultCategoryIds
      };

      // WordPressに投稿
      const publishResult = await this.publishToWordPress(publishRequest);

      console.log(`RSS entry processing completed: ${publishResult.success ? 'SUCCESS' : 'FAILED'}`);

      return publishResult;

    } catch (error) {
      console.error('Failed to generate and publish from RSS entry:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: {} as GeneratedArticle
      };
    }
  }

  /**
   * Batch process multiple RSS entries
   */
  async batchProcessRSSEntries(
    rssEntries: RssArticleEntry[],
    options: {
      concurrency?: number;
      delayBetweenRequests?: number;
      publishStatus?: PostStatus;
      authorId?: string;
      categoryIds?: string[];
    } = {}
  ): Promise<ArticlePublishResult[]> {
    const { concurrency = 2, delayBetweenRequests = 2000 } = options;
    const results: ArticlePublishResult[] = [];

    console.log(`Starting batch processing of ${rssEntries.length} RSS entries with concurrency ${concurrency}`);

    // 処理を小さなチャンクに分割（慎重に処理）
    for (let i = 0; i < rssEntries.length; i += concurrency) {
      const chunk = rssEntries.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (rssEntry) => {
        try {
          return await this.generateAndPublishFromRssEntry(rssEntry, {
            publishStatus: options.publishStatus,
            authorId: options.authorId,
            categoryIds: options.categoryIds
          });
        } catch (error) {
          console.error(`Failed to process RSS entry: ${rssEntry.title}`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            article: {} as GeneratedArticle
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // チャンク間の遅延（APIレート制限対策）
      if (i + concurrency < rssEntries.length && delayBetweenRequests > 0) {
        console.log(`Waiting ${delayBetweenRequests}ms before processing next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Batch RSS processing completed: ${successCount}/${results.length} successful`);

    return results;
  }

  /**
   * Batch process multiple RSS items
   */
  async batchProcessRSSItems(
    rssItems: RSSArticleRequest[],
    options: {
      concurrency?: number;
      delayBetweenRequests?: number;
    } = {}
  ): Promise<ArticlePublishResult[]> {
    const { concurrency = 3, delayBetweenRequests = 1000 } = options;
    const results: ArticlePublishResult[] = [];

    console.log(`Starting batch processing of ${rssItems.length} RSS items with concurrency ${concurrency}`);

    // Process in chunks to avoid overwhelming the APIs
    for (let i = 0; i < rssItems.length; i += concurrency) {
      const chunk = rssItems.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (rssItem) => {
        try {
          return await this.generateAndPublishFromRSS(rssItem);
        } catch (error) {
          console.error(`Failed to process RSS item: ${rssItem.rssItem.title}`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            article: {} as GeneratedArticle
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Add delay between chunks
      if (i + concurrency < rssItems.length && delayBetweenRequests > 0) {
        console.log(`Waiting ${delayBetweenRequests}ms before processing next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Batch processing completed: ${successCount}/${results.length} successful`);

    return results;
  }

  /**
   * Convert category names to IDs (implement based on WordPress API)
   */
  private async prepareCategoryIds(categoryNames: string[], existingIds?: string[]): Promise<string[] | undefined> {
    // If explicit IDs are provided, use them
    if (existingIds && existingIds.length > 0) {
      return existingIds;
    }

    // If no categories, return undefined
    if (!categoryNames || categoryNames.length === 0) {
      return undefined;
    }

    // TODO: Implement category name to ID conversion
    // For now, return undefined and let WordPress handle it
    console.log('Category name to ID conversion not implemented yet, categories:', categoryNames);
    return undefined;
  }

  /**
   * Convert tag names to IDs (implement based on WordPress API)
   */
  private async prepareTagIds(tagNames: string[]): Promise<string[] | undefined> {
    // If no tags, return undefined
    if (!tagNames || tagNames.length === 0) {
      return undefined;
    }

    // TODO: Implement tag name to ID conversion
    // For now, return undefined and let WordPress handle it
    console.log('Tag name to ID conversion not implemented yet, tags:', tagNames);
    return undefined;
  }
}

export default ArticleGenerationService;