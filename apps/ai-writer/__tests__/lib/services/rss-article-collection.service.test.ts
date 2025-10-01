/**
 * RSS記事収集サービスのテスト
 */

import { jest } from '@jest/globals';
import RssArticleCollectionService from '../../../lib/services/rss-article-collection.service';
import { RssFeedService } from '../../../lib/services/rss-feed.service';
import type { RssFeed, ValidationConfig } from '../../../lib/types/rss-feed';
import type { RssArticleEntry } from '../../../lib/types/rss-article';

// モックしたRSS Parserインスタンス
const mockParseURL = jest.fn();

// RSS Parserのモック
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL
  }));
});
jest.mock('../../../lib/services/rss-feed.service');

// モック用のテストデータ
const mockFeed: RssFeed = {
  id: 'test-feed-1',
  url: 'https://example.com/rss.xml',
  title: 'Test Feed',
  description: 'Test Description',
  isActive: true,
  validationConfig: {
    keywords: ['テスト', 'プログラミング'],
    keywordLogic: 'OR',
    requireJapanese: true,
    minScore: 70,
    isEnabled: true
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'test-user'
};

const mockRssResponse = {
  title: 'Test Feed',
  items: [
    {
      title: 'テストプログラミング記事',
      link: 'https://example.com/article1',
      description: 'これはテスト記事です',
      pubDate: '2024-01-01T00:00:00Z',
      categories: ['プログラミング', 'テスト'],
      guid: 'article-1'
    },
    {
      title: 'English Article',
      link: 'https://example.com/article2',
      description: 'This is an English article',
      pubDate: '2024-01-02T00:00:00Z',
      categories: ['programming'],
      guid: 'article-2'
    },
    {
      title: '無関係な記事',
      link: 'https://example.com/article3',
      description: 'これは無関係な内容の記事です',
      pubDate: '2024-01-03T00:00:00Z',
      categories: ['その他'],
      guid: 'article-3'
    }
  ]
};

describe('RssArticleCollectionService', () => {
  let service: RssArticleCollectionService;

  beforeEach(() => {
    jest.clearAllMocks();

    // RssFeedServiceのモック設定
    (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
      .mockResolvedValue([mockFeed]);
    (RssFeedService.getFeed as jest.MockedFunction<typeof RssFeedService.getFeed>)
      .mockResolvedValue(mockFeed);

    // サービスインスタンス作成（RSS Parserは自動でモックされる）
    service = new RssArticleCollectionService();
  });

  describe('collectArticles', () => {
    it('should collect articles from active feeds', async () => {
      mockParseURL.mockResolvedValue(mockRssResponse);

      const result = await service.collectArticles();

      expect(result).toBeDefined();
      expect(result.totalFeeds).toBe(1);
      expect(result.totalArticles).toBe(3);
      expect(result.validArticles).toBe(1); // 日本語でキーワードマッチする記事のみ
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0].title).toBe('テストプログラミング記事');
    });

    it('should handle empty feeds list', async () => {
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockResolvedValue([]);

      const result = await service.collectArticles();

      expect(result.totalFeeds).toBe(0);
      expect(result.totalArticles).toBe(0);
      expect(result.validArticles).toBe(0);
      expect(result.articles).toHaveLength(0);
    });

    it('should handle RSS parsing errors', async () => {
      mockParseURL.mockRejectedValue(new Error('RSS parsing failed'));

      const result = await service.collectArticles();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('RSS parsing failed');
    });

    it('should handle RssFeedService errors', async () => {
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockRejectedValue(new Error('Database error'));

      const result = await service.collectArticles();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database error');
    });
  });

  describe('validateArticle', () => {
    const testArticle: RssArticleEntry = {
      title: 'テストプログラミング記事',
      link: 'https://example.com/article',
      description: 'これはテスト記事です',
      content: '',
      pubDate: '2024-01-01T00:00:00Z',
      categories: ['プログラミング'],
      guid: 'test-article',
      source: {
        feedId: 'test-feed',
        feedTitle: 'Test Feed',
        feedUrl: 'https://example.com/rss.xml'
      }
    };

    it('should validate article with keywords (OR logic)', async () => {
      const validationConfig: ValidationConfig = {
        keywords: ['テスト', 'プログラミング'],
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 70,
        isEnabled: true
      };

      const feed = { ...mockFeed, validationConfig };

      // validateArticle は private なので、collectArticles を通してテストする
      mockParseURL.mockResolvedValue({
        ...mockRssResponse,
        items: [testArticle]
      });
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockResolvedValue([feed]);

      const result = await service.collectArticles();

      expect(result.validArticles).toBe(1);
      expect(result.articles[0].title).toBe('テストプログラミング記事');
    });

    it('should reject article without required keywords (AND logic)', async () => {
      const validationConfig: ValidationConfig = {
        keywords: ['テスト', '存在しないキーワード'],
        keywordLogic: 'AND',
        requireJapanese: true,
        minScore: 70,
        isEnabled: true
      };

      const feed = { ...mockFeed, validationConfig };

      mockParseURL.mockResolvedValue({
        ...mockRssResponse,
        items: [testArticle]
      });
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockResolvedValue([feed]);

      const result = await service.collectArticles();

      expect(result.validArticles).toBe(0);
    });

    it('should accept all articles when validation is disabled', async () => {
      const validationConfig: ValidationConfig = {
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 0,
        isEnabled: false
      };

      const feed = { ...mockFeed, validationConfig };

      mockParseURL.mockResolvedValue(mockRssResponse);
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockResolvedValue([feed]);

      const result = await service.collectArticles();

      expect(result.validArticles).toBe(3); // 全記事が有効
    });

    it('should detect Japanese text correctly', async () => {
      const englishArticle = {
        title: 'English Programming Article',
        link: 'https://example.com/english',
        description: 'This is an English article about programming',
        content: '',
        pubDate: '2024-01-01T00:00:00Z',
        categories: ['programming'],
        guid: 'english-article',
        source: {
          feedId: 'test-feed',
          feedTitle: 'Test Feed',
          feedUrl: 'https://example.com/rss.xml'
        }
      };

      const validationConfig: ValidationConfig = {
        keywords: ['programming'], // 英語でもマッチするキーワード
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 70,
        isEnabled: true
      };

      const feed = { ...mockFeed, validationConfig };

      mockParseURL.mockResolvedValue({
        ...mockRssResponse,
        items: [englishArticle]
      });
      (RssFeedService.listFeeds as jest.MockedFunction<typeof RssFeedService.listFeeds>)
        .mockResolvedValue([feed]);

      const result = await service.collectArticles();

      expect(result.validArticles).toBe(0); // 日本語必須なので無効
    });
  });

  describe('collectArticlesFromFeed', () => {
    it('should collect articles from specific feed', async () => {
      mockParseURL.mockResolvedValue(mockRssResponse);

      const articles = await service.collectArticlesFromFeed('test-feed-1');

      expect(RssFeedService.getFeed).toHaveBeenCalledWith('test-feed-1');
      expect(articles).toHaveLength(1); // 妥当な記事のみ
      expect(articles[0].title).toBe('テストプログラミング記事');
    });

    it('should throw error for non-existent feed', async () => {
      (RssFeedService.getFeed as jest.MockedFunction<typeof RssFeedService.getFeed>)
        .mockResolvedValue(null);

      await expect(service.collectArticlesFromFeed('non-existent'))
        .rejects.toThrow('Feed not found: non-existent');
    });

    it('should throw error for inactive feed', async () => {
      const inactiveFeed = { ...mockFeed, isActive: false };
      (RssFeedService.getFeed as jest.MockedFunction<typeof RssFeedService.getFeed>)
        .mockResolvedValue(inactiveFeed);

      await expect(service.collectArticlesFromFeed('test-feed-1'))
        .rejects.toThrow('Feed is not active: test-feed-1');
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const config = service.getConfig();

      expect(config.maxArticlesPerFeed).toBe(10);
    });

    it('should allow configuration updates', () => {
      service.updateConfig({ maxArticlesPerFeed: 5 });

      const config = service.getConfig();
      expect(config.maxArticlesPerFeed).toBe(5);
    });

    it('should limit articles per feed', async () => {
      service.updateConfig({ maxArticlesPerFeed: 2 });
      mockParseURL.mockResolvedValue(mockRssResponse);

      const result = await service.collectArticles();

      expect(result.totalArticles).toBe(2); // 制限により2記事のみ
    });
  });
});