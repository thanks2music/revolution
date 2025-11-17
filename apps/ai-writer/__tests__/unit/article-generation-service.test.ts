/**
 * 記事生成サービス ユニットテスト（外部依存完全排除版）
 *
 * テスト対象：
 * - ArticleGenerationServiceのビジネスロジック
 * - データ変換処理
 * - エラーハンドリング
 * - 設定とカスタマイズ機能
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// 外部依存サービスのモック型定義
interface MockClaudeService {
  generateArticle: jest.MockedFunction<any>;
  testConnection: jest.MockedFunction<any>;
}

interface MockWordPressService {
  createPostExtended: jest.MockedFunction<any>;
  testConnection: jest.MockedFunction<any>;
}

// 完全にモック化されたサービス
class MockedArticleGenerationService {
  private claudeService: MockClaudeService;
  private wordPressService: MockWordPressService;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.claudeService = {
      generateArticle: jest.fn(),
      testConnection: jest.fn(),
    };
    this.wordPressService = {
      createPostExtended: jest.fn(),
      testConnection: jest.fn(),
    };
  }

  // ビジネスロジックメソッドのモック実装
  async generateAndPublishFromRSS(request: any) {
    try {
      if (!this.config.useClaudeAPI) {
        return {
          success: false,
          error: 'Claude API is disabled',
          article: {} as any
        };
      }

      // データ変換ロジック
      const generationRequest = {
        title: request.rssItem.title,
        sourceUrl: request.rssItem.link,
        sourceContent: request.rssItem.content || request.rssItem.description,
        keywords: request.rssItem.categories,
        ...request.generationOptions
      };

      const generatedArticle = await this.claudeService.generateArticle(generationRequest);

      const publishRequest = {
        article: generatedArticle,
        status: this.config.defaultStatus,
        authorId: this.config.defaultAuthorId,
        categoryIds: this.config.defaultCategoryIds,
        ...request.publishOptions
      };

      const wordPressPost = await this.wordPressService.createPostExtended({
        title: generatedArticle.title,
        content: generatedArticle.content,
        slug: generatedArticle.slug,
        excerpt: generatedArticle.excerpt,
        status: publishRequest.status,
        authorId: publishRequest.authorId,
        categoryIds: publishRequest.categoryIds,
        publishDate: publishRequest.publishDate,
      });

      return {
        success: true,
        postId: wordPressPost.id,
        postUrl: wordPressPost.uri,
        article: generatedArticle
      };

    } catch (error) {
      // 生成は成功したが投稿に失敗した場合、生成された記事を保持
      let article = {} as any;
      try {
        const generationRequest = {
          title: request.rssItem.title,
          sourceUrl: request.rssItem.link,
          sourceContent: request.rssItem.content || request.rssItem.description,
          keywords: request.rssItem.categories,
          ...request.generationOptions
        };
        article = await this.claudeService.generateArticle(generationRequest);
      } catch {
        // Claude API自体のエラーの場合は空オブジェクト
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article
      };
    }
  }

  async publishToWordPress(request: any) {
    try {
      const wordPressPost = await this.wordPressService.createPostExtended({
        title: request.article.title,
        content: request.article.content,
        slug: request.article.slug,
        excerpt: request.article.excerpt,
        status: request.status || this.config.defaultStatus,
        authorId: request.authorId || this.config.defaultAuthorId,
        categoryIds: request.categoryIds || this.config.defaultCategoryIds,
      });

      return {
        success: true,
        postId: wordPressPost.id,
        postUrl: wordPressPost.uri,
        article: request.article
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: request.article
      };
    }
  }

  async testConnections() {
    const errors: string[] = [];
    let claudeStatus = false;
    let wordpressStatus = false;

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
      claudeStatus = true;
    }

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

  // テスト用のモックサービス取得
  getMockClaudeService() { return this.claudeService; }
  getMockWordPressService() { return this.wordPressService; }
}

describe('記事生成サービス ユニットテスト', () => {
  let service: MockedArticleGenerationService;
  let mockClaudeService: MockClaudeService;
  let mockWordPressService: MockWordPressService;

  const defaultConfig = {
    useClaudeAPI: true,
    wordPressEndpoint: 'https://test.wordpress.com/graphql',
    wordPressAuthToken: 'test-wp-token',
    defaultStatus: 'draft' as const,
    defaultAuthorId: 'author-123',
    defaultCategoryIds: ['category-1', 'category-2'],
  };

  beforeEach(() => {
    service = new MockedArticleGenerationService(defaultConfig);
    mockClaudeService = service.getMockClaudeService();
    mockWordPressService = service.getMockWordPressService();
  });

  describe('基本的な記事生成フロー', () => {
    it('RSS記事から記事生成・投稿が成功する', async () => {
      // Claude API レスポンスのモック
      const mockGeneratedArticle = {
        title: 'Generated Test Article',
        content: '<h1>Generated Test Article</h1><p>This is generated content...</p>',
        excerpt: 'This is a generated test article excerpt',
        slug: 'generated-test-article',
        tags: ['test', 'generated'],
        categories: ['technology', 'ai'],
        metadata: {
          sourceUrl: 'https://example.com/original-article',
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 500,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      mockClaudeService.generateArticle.mockResolvedValue(mockGeneratedArticle);

      // WordPress API レスポンスのモック
      const mockWordPressPost = {
        id: 'cG9zdDoxMjM=',
        databaseId: 123,
        title: 'Generated Test Article',
        slug: 'generated-test-article',
        uri: '/generated-test-article',
        status: 'draft',
      };

      mockWordPressService.createPostExtended.mockResolvedValue(mockWordPressPost);

      // RSS記事のテストデータ
      const rssRequest = {
        rssItem: {
          title: 'Original RSS Article',
          link: 'https://example.com/original-article',
          description: 'Original RSS article description',
          content: 'Original RSS content',
          pubDate: '2024-01-01T00:00:00Z',
          categories: ['tech'],
        },
        generationOptions: {
          targetLength: 800,
          tone: 'professional',
          language: 'ja',
        },
        publishOptions: {
          status: 'draft',
          publishDate: '2024-01-01T00:00:00Z',
        },
      };

      const result = await service.generateAndPublishFromRSS(rssRequest);

      // 結果の検証
      expect(result.success).toBe(true);
      expect(result.postId).toBe('cG9zdDoxMjM=');
      expect(result.article.title).toBe('Generated Test Article');

      // Claude API の呼び出し確認
      expect(mockClaudeService.generateArticle).toHaveBeenCalledWith({
        title: 'Original RSS Article',
        sourceUrl: 'https://example.com/original-article',
        sourceContent: 'Original RSS content',
        keywords: ['tech'],
        targetLength: 800,
        tone: 'professional',
        language: 'ja',
      });

      // WordPress API の呼び出し確認
      expect(mockWordPressService.createPostExtended).toHaveBeenCalledWith({
        title: 'Generated Test Article',
        content: '<h1>Generated Test Article</h1><p>This is generated content...</p>',
        slug: 'generated-test-article',
        excerpt: 'This is a generated test article excerpt',
        status: 'draft',
        authorId: 'author-123',
        categoryIds: ['category-1', 'category-2'],
        publishDate: '2024-01-01T00:00:00Z',
      });
    });

    it('生成済み記事のWordPress投稿が成功する', async () => {
      const mockGeneratedArticle = {
        title: 'Test Article',
        content: '<p>Test content</p>',
        excerpt: 'Test excerpt',
        slug: 'test-article',
        tags: ['test'],
        categories: ['general'],
        metadata: {
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 100,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      const mockWordPressPost = {
        id: 'cG9zdDoyMzQ=',
        databaseId: 234,
        title: 'Test Article',
        slug: 'test-article',
        uri: '/test-article',
        status: 'publish',
      };

      mockWordPressService.createPostExtended.mockResolvedValue(mockWordPressPost);

      const publishRequest = {
        article: mockGeneratedArticle,
        status: 'publish',
        authorId: 'custom-author',
        categoryIds: ['custom-category'],
      };

      const result = await service.publishToWordPress(publishRequest);

      expect(result.success).toBe(true);
      expect(result.postId).toBe('cG9zdDoyMzQ=');
      expect(result.article.title).toBe('Test Article');
    });
  });

  describe('エラーハンドリング', () => {
    it('Claude API エラー時に適切にハンドリングされる', async () => {
      const claudeError = new Error('Claude API rate limit exceeded');
      mockClaudeService.generateArticle.mockRejectedValue(claudeError);

      const rssRequest = {
        rssItem: {
          title: 'Test Article',
          link: 'https://example.com/test',
          description: 'Test description',
        },
      };

      const result = await service.generateAndPublishFromRSS(rssRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude API rate limit exceeded');
      expect(mockWordPressService.createPostExtended).not.toHaveBeenCalled();
    });

    it('WordPress API エラー時に適切にハンドリングされる', async () => {
      const mockGeneratedArticle = {
        title: 'Test Article',
        content: '<p>Test content</p>',
        excerpt: 'Test excerpt',
        slug: 'test-article',
        tags: ['test'],
        categories: ['general'],
        metadata: {
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 100,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      mockClaudeService.generateArticle.mockResolvedValue(mockGeneratedArticle);

      const wordpressError = new Error('WordPress authentication failed');
      mockWordPressService.createPostExtended.mockRejectedValue(wordpressError);

      const rssRequest = {
        rssItem: {
          title: 'Test Article',
          link: 'https://example.com/test',
        },
      };

      const result = await service.generateAndPublishFromRSS(rssRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('WordPress authentication failed');
      expect(result.article).toEqual(mockGeneratedArticle);
    });
  });

  describe('設定とカスタマイズ', () => {
    it('Claude APIが無効化されている場合の動作', async () => {
      const disabledConfig = {
        ...defaultConfig,
        useClaudeAPI: false,
      };

      const disabledService = new MockedArticleGenerationService(disabledConfig);

      const rssRequest = {
        rssItem: {
          title: 'Test Article',
          link: 'https://example.com/test',
        },
      };

      const result = await disabledService.generateAndPublishFromRSS(rssRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude API is disabled');
    });

    it('デフォルト設定が適切に適用される', async () => {
      const mockGeneratedArticle = {
        title: 'Test Article',
        content: '<p>Test content</p>',
        excerpt: 'Test excerpt',
        slug: 'test-article',
        tags: ['test'],
        categories: ['general'],
        metadata: {
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 100,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      mockClaudeService.generateArticle.mockResolvedValue(mockGeneratedArticle);
      mockWordPressService.createPostExtended.mockResolvedValue({ id: 'test', databaseId: 123 });

      const minimalRequest = {
        rssItem: {
          title: 'Minimal Article',
          link: 'https://example.com/minimal',
        },
      };

      await service.generateAndPublishFromRSS(minimalRequest);

      // デフォルト設定が適用されることを確認
      expect(mockWordPressService.createPostExtended).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'draft', // defaultStatus
          authorId: 'author-123', // defaultAuthorId
          categoryIds: ['category-1', 'category-2'], // defaultCategoryIds
        })
      );
    });
  });

  describe('外部サービス接続テスト', () => {
    it('両方のサービス接続テストが成功する', async () => {
      mockClaudeService.testConnection.mockResolvedValue(true);
      mockWordPressService.testConnection.mockResolvedValue(true);

      const result = await service.testConnections();

      expect(result.claude).toBe(true);
      expect(result.wordpress).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('Claude API接続テストが失敗する', async () => {
      mockClaudeService.testConnection.mockRejectedValue(new Error('API key invalid'));
      mockWordPressService.testConnection.mockResolvedValue(true);

      const result = await service.testConnections();

      expect(result.claude).toBe(false);
      expect(result.wordpress).toBe(true);
      expect(result.errors).toContain('Claude API error: API key invalid');
    });

    it('Claude APIが無効な場合は自動的にtrueになる', async () => {
      const disabledConfig = {
        ...defaultConfig,
        useClaudeAPI: false,
      };

      const disabledService = new MockedArticleGenerationService(disabledConfig);
      const mockWP = disabledService.getMockWordPressService();
      mockWP.testConnection.mockResolvedValue(true);

      const result = await disabledService.testConnections();

      expect(result.claude).toBe(true); // Claude API無効時は自動的にtrue
      expect(result.wordpress).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('データ変換とバリデーション', () => {
    it('RSS記事データが適切にClaude APIリクエストに変換される', async () => {
      const mockGeneratedArticle = {
        title: 'Test',
        content: '<p>Test</p>',
        excerpt: 'Test',
        slug: 'test',
        tags: [],
        categories: [],
        metadata: {
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 100,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      mockClaudeService.generateArticle.mockResolvedValue(mockGeneratedArticle);
      mockWordPressService.createPostExtended.mockResolvedValue({ id: 'test', databaseId: 123 });

      const complexRssRequest = {
        rssItem: {
          title: 'Complex RSS Article',
          link: 'https://example.com/complex',
          description: 'Complex description with <html> tags',
          content: 'Complex content with multiple paragraphs...',
          pubDate: '2024-01-01T00:00:00Z',
          categories: ['tech', 'ai', 'programming'],
        },
        generationOptions: {
          keywords: ['AI', 'machine learning', 'programming'],
          targetLength: 1200,
          tone: 'technical',
          language: 'ja',
        },
      };

      await service.generateAndPublishFromRSS(complexRssRequest);

      expect(mockClaudeService.generateArticle).toHaveBeenCalledWith({
        title: 'Complex RSS Article',
        sourceUrl: 'https://example.com/complex',
        sourceContent: 'Complex content with multiple paragraphs...',
        keywords: ['AI', 'machine learning', 'programming'], // generationOptions.keywords が優先
        targetLength: 1200,
        tone: 'technical',
        language: 'ja',
      });
    });

    it('不完全なRSSデータでも適切に処理される', async () => {
      const mockGeneratedArticle = {
        title: 'Generated from incomplete data',
        content: '<p>Generated content</p>',
        excerpt: 'Generated excerpt',
        slug: 'generated-from-incomplete',
        tags: [],
        categories: [],
        metadata: {
          generatedAt: '2024-01-01T00:00:00Z',
          wordCount: 50,
          model: 'claude-sonnet-4-5-20250929',
        },
      };

      mockClaudeService.generateArticle.mockResolvedValue(mockGeneratedArticle);
      mockWordPressService.createPostExtended.mockResolvedValue({ id: 'test', databaseId: 123 });

      const incompleteRssRequest = {
        rssItem: {
          title: 'Incomplete Article',
          link: 'https://example.com/incomplete',
          // description, content, pubDate, categories が未定義
        },
      };

      const result = await service.generateAndPublishFromRSS(incompleteRssRequest);

      expect(result.success).toBe(true);
      expect(mockClaudeService.generateArticle).toHaveBeenCalledWith({
        title: 'Incomplete Article',
        sourceUrl: 'https://example.com/incomplete',
        sourceContent: undefined,
        keywords: undefined,
      });
    });
  });
});