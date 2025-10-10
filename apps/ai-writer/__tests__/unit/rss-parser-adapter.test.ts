/**
 * RSS解析アダプターの包括的テスト
 *
 * テスト対象：
 * - RSS Parser の初期化とカスタムフィールド設定
 * - RSS フィードの解析処理
 * - データ変換（RSS Item → RssArticleEntry）
 * - エラーハンドリング（無効な URL、ネットワークエラー、パース失敗）
 * - 記事数制限機能
 * - 異なる RSS フォーマット対応
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import RssArticleCollectionService from '../../lib/services/rss-article-collection.service';
import type { RssFeed } from '../../lib/types/rss-feed';
import type { RssCollectionConfig } from '../../lib/types/rss-article';

// RSS Parser をモック
jest.mock('rss-parser');

// RssFeedService をモック
jest.mock('../../lib/services/rss-feed.service', () => ({
  RssFeedService: {
    listFeeds: jest.fn(),
    getFeed: jest.fn(),
  },
}));

// テスト用にprivateメソッドを公開するクラス
class TestableRssArticleCollectionService extends RssArticleCollectionService {
  public testProcessFeed(feed: RssFeed) {
    // @ts-ignore: Accessing private method for testing
    return this.processFeed(feed);
  }

  public getParser() {
    // @ts-ignore: Accessing private property for testing
    return this.parser;
  }

  public getConfig() {
    // @ts-ignore: Accessing private property for testing
    return this.config;
  }
}

describe('RSS解析アダプター', () => {
  let service: TestableRssArticleCollectionService;
  let mockParser: any;

  beforeEach(() => {
    // Parser のモックを作成
    mockParser = {
      parseURL: jest.fn(),
    };

    // rss-parser モックの設定
    const MockParser = jest.fn().mockImplementation(() => mockParser);
    require('rss-parser').default = MockParser;

    service = new TestableRssArticleCollectionService();
  });

  describe('RSS Parser 初期化', () => {
    it('デフォルト設定でパーサーが初期化される', () => {
      const config = service.getConfig();
      expect(config.maxArticlesPerFeed).toBe(10);
    });

    it('カスタム設定でパーサーが初期化される', () => {
      const customConfig: Partial<RssCollectionConfig> = {
        maxArticlesPerFeed: 20,
      };

      const customService = new TestableRssArticleCollectionService(customConfig);
      const config = customService.getConfig();

      expect(config.maxArticlesPerFeed).toBe(20);
    });

    it('RSS Parser にカスタムフィールドが設定される', () => {
      // Parser が適切なオプションで初期化されることを確認
      const MockParser = require('rss-parser').default;

      expect(MockParser).toHaveBeenCalledWith({
        customFields: {
          item: ['content', 'content:encoded', 'description']
        }
      });
    });
  });

  describe('RSS フィード解析', () => {
    const mockFeed: RssFeed = {
      id: 'test-feed',
      url: 'https://example.com/rss.xml',
      title: 'Test Feed',
      isActive: true,
      validationConfig: {
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 50,
        isEnabled: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'test-user',
    };

    it('正常なRSSフィードを解析できる', async () => {
      const mockRssData = {
        title: 'Test RSS Feed',
        items: [
          {
            title: 'Article 1',
            link: 'https://example.com/article1',
            description: 'Article 1 description',
            'content:encoded': '<p>Full content of article 1</p>',
            pubDate: '2024-01-01T00:00:00Z',
            categories: ['tech', 'programming'],
            guid: 'article-1-guid',
          },
          {
            title: 'Article 2',
            link: 'https://example.com/article2',
            contentSnippet: 'Article 2 snippet',
            content: 'Simple content',
            isoDate: '2024-01-02T00:00:00Z',
            id: 'article-2-id',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result).toHaveLength(2);

      // 1つ目の記事をチェック
      expect(result[0]).toEqual({
        title: 'Article 1',
        link: 'https://example.com/article1',
        description: 'Article 1 description',
        content: '<p>Full content of article 1</p>',
        pubDate: '2024-01-01T00:00:00Z',
        categories: ['tech', 'programming'],
        guid: 'article-1-guid',
        source: {
          feedId: 'test-feed',
          feedTitle: 'Test Feed', // feed.title が優先される
          feedUrl: 'https://example.com/rss.xml',
        },
      });

      // 2つ目の記事をチェック
      expect(result[1]).toEqual({
        title: 'Article 2',
        link: 'https://example.com/article2',
        description: 'Article 2 snippet',
        content: 'Simple content',
        pubDate: '2024-01-02T00:00:00Z',
        categories: [],
        guid: 'article-2-id',
        source: {
          feedId: 'test-feed',
          feedTitle: 'Test Feed', // feed.title が優先される
          feedUrl: 'https://example.com/rss.xml',
        },
      });
    });

    it('記事数制限が正しく適用される', async () => {
      const limitedService = new TestableRssArticleCollectionService({
        maxArticlesPerFeed: 2,
      });

      const mockRssData = {
        title: 'Test Feed',
        items: Array.from({ length: 5 }, (_, i) => ({
          title: `Article ${i + 1}`,
          link: `https://example.com/article${i + 1}`,
          description: `Description ${i + 1}`,
          guid: `guid-${i + 1}`,
        })),
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await limitedService.testProcessFeed(mockFeed);

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Article 1');
      expect(result[1].title).toBe('Article 2');
    });

    it('記事数制限が設定されていない場合は全記事を取得', async () => {
      const unlimitedService = new TestableRssArticleCollectionService({
        maxArticlesPerFeed: undefined,
      });

      const mockRssData = {
        title: 'Test Feed',
        items: Array.from({ length: 3 }, (_, i) => ({
          title: `Article ${i + 1}`,
          link: `https://example.com/article${i + 1}`,
          guid: `guid-${i + 1}`,
        })),
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await unlimitedService.testProcessFeed(mockFeed);

      expect(result).toHaveLength(3);
    });
  });

  describe('データ変換処理', () => {
    const mockFeed: RssFeed = {
      id: 'test-feed',
      url: 'https://example.com/rss.xml',
      title: 'Test Feed',
      isActive: true,
      validationConfig: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'test-user',
    };

    it('不完全なデータでもデフォルト値で補完される', async () => {
      const mockRssData = {
        title: 'Test Feed',
        items: [
          {
            // title なし
            link: 'https://example.com/article',
            // description なし
            // content なし
            // pubDate なし
            // categories なし
            // guid なし
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result[0]).toEqual({
        title: 'No title',
        link: 'https://example.com/article',
        description: '',
        content: '',
        pubDate: '',
        categories: [],
        guid: '',
        source: {
          feedId: 'test-feed',
          feedTitle: 'Test Feed',
          feedUrl: 'https://example.com/rss.xml',
        },
      });
    });

    it('content の優先順位が正しく適用される', async () => {
      const mockRssData = {
        title: 'Test Feed',
        items: [
          {
            title: 'Test Article',
            'content:encoded': 'Full HTML content',
            content: 'Simple content',
            description: 'Description text',
            contentSnippet: 'Snippet text',
            summary: 'Summary text',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await service.testProcessFeed(mockFeed);

      // content は content:encoded が優先
      expect(result[0].content).toBe('Full HTML content');
      // description は contentSnippet が優先
      expect(result[0].description).toBe('Snippet text');
    });

    it('異なる日付フォーマットが正しく処理される', async () => {
      const mockRssData = {
        title: 'Test Feed',
        items: [
          {
            title: 'Article with pubDate',
            pubDate: 'Wed, 01 Jan 2024 00:00:00 GMT',
          },
          {
            title: 'Article with isoDate',
            isoDate: '2024-01-02T00:00:00Z',
          },
          {
            title: 'Article without date',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result[0].pubDate).toBe('Wed, 01 Jan 2024 00:00:00 GMT');
      expect(result[1].pubDate).toBe('2024-01-02T00:00:00Z');
      expect(result[2].pubDate).toBe('');
    });

    it('GUID の優先順位が正しく適用される', async () => {
      const mockRssData = {
        title: 'Test Feed',
        items: [
          {
            title: 'Article with guid',
            guid: 'specific-guid',
            id: 'fallback-id',
          },
          {
            title: 'Article with id only',
            id: 'only-id',
          },
          {
            title: 'Article without guid/id',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mockRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result[0].guid).toBe('specific-guid');
      expect(result[1].guid).toBe('only-id');
      expect(result[2].guid).toBe('');
    });
  });

  describe('エラーハンドリング', () => {
    const mockFeed: RssFeed = {
      id: 'error-feed',
      url: 'https://invalid.example.com/rss.xml',
      title: 'Error Feed',
      isActive: true,
      validationConfig: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'test-user',
    };

    it('ネットワークエラーを適切にハンドリングする', async () => {
      const networkError = new Error('Network timeout');
      mockParser.parseURL.mockRejectedValue(networkError);

      await expect(service.testProcessFeed(mockFeed)).rejects.toThrow(
        'RSS parsing failed: Network timeout'
      );
    });

    it('無効なRSSフォーマットエラーをハンドリングする', async () => {
      const parseError = new Error('Invalid XML format');
      mockParser.parseURL.mockRejectedValue(parseError);

      await expect(service.testProcessFeed(mockFeed)).rejects.toThrow(
        'RSS parsing failed: Invalid XML format'
      );
    });

    it('不明なエラーをハンドリングする', async () => {
      mockParser.parseURL.mockRejectedValue('Unknown error string');

      await expect(service.testProcessFeed(mockFeed)).rejects.toThrow(
        'RSS parsing failed: Unknown error'
      );
    });

    it('空のRSSフィードを適切に処理する', async () => {
      const emptyRssData = {
        title: 'Empty Feed',
        items: [],
      };

      mockParser.parseURL.mockResolvedValue(emptyRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result).toEqual([]);
    });

    it('items プロパティがない場合を処理する', async () => {
      const noItemsRssData = {
        title: 'No Items Feed',
        // items プロパティなし
      };

      mockParser.parseURL.mockResolvedValue(noItemsRssData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result).toEqual([]);
    });
  });

  describe('RSS フォーマット互換性', () => {
    const mockFeed: RssFeed = {
      id: 'format-feed',
      url: 'https://example.com/feed.xml',
      title: 'Format Feed',
      isActive: true,
      validationConfig: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'test-user',
    };

    it('RSS 2.0 フォーマットを処理できる', async () => {
      const rss20Data = {
        title: 'RSS 2.0 Feed',
        items: [
          {
            title: 'RSS 2.0 Article',
            link: 'https://example.com/rss20-article',
            description: 'RSS 2.0 description',
            pubDate: 'Wed, 01 Jan 2024 00:00:00 GMT',
            categories: ['tech'],
            guid: 'rss20-guid',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(rss20Data);

      const result = await service.testProcessFeed(mockFeed);

      expect(result[0].title).toBe('RSS 2.0 Article');
      expect(result[0].pubDate).toBe('Wed, 01 Jan 2024 00:00:00 GMT');
    });

    it('Atom フィードフォーマットを処理できる', async () => {
      const atomData = {
        title: 'Atom Feed',
        items: [
          {
            title: 'Atom Article',
            link: 'https://example.com/atom-article',
            summary: 'Atom summary',
            isoDate: '2024-01-01T00:00:00Z',
            id: 'atom-id',
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(atomData);

      const result = await service.testProcessFeed(mockFeed);

      expect(result[0].title).toBe('Atom Article');
      expect(result[0].description).toBe('Atom summary');
      expect(result[0].pubDate).toBe('2024-01-01T00:00:00Z');
      expect(result[0].guid).toBe('atom-id');
    });

    it('混合フィールドを持つフィードを処理できる', async () => {
      const mixedData = {
        title: 'Mixed Feed',
        items: [
          {
            title: 'Mixed Article',
            link: 'https://example.com/mixed-article',
            description: 'Primary description',
            contentSnippet: 'Content snippet',
            summary: 'Summary text',
            content: 'Basic content',
            'content:encoded': '<p>Encoded content</p>',
            pubDate: 'Wed, 01 Jan 2024 00:00:00 GMT',
            isoDate: '2024-01-01T00:00:00Z',
            guid: 'primary-guid',
            id: 'fallback-id',
            categories: ['mixed', 'test'],
          },
        ],
      };

      mockParser.parseURL.mockResolvedValue(mixedData);

      const result = await service.testProcessFeed(mockFeed);

      // 適切な優先順位で値が選択されることを確認
      expect(result[0]).toEqual({
        title: 'Mixed Article',
        link: 'https://example.com/mixed-article',
        description: 'Content snippet', // contentSnippet が優先
        content: '<p>Encoded content</p>', // content:encoded が優先
        pubDate: 'Wed, 01 Jan 2024 00:00:00 GMT', // pubDate が優先
        categories: ['mixed', 'test'],
        guid: 'primary-guid', // guid が優先
        source: {
          feedId: 'format-feed',
          feedTitle: 'Format Feed', // feed.title が優先される
          feedUrl: 'https://example.com/feed.xml',
        },
      });
    });
  });
});