/**
 * テスト用モック関数
 */

import { jest } from '@jest/globals';

// Claude API モック
export const mockClaudeAPI = {
  generateArticle: jest.fn().mockResolvedValue({
    title: 'Generated Article',
    content: 'Generated content...',
    excerpt: 'Generated excerpt',
    slug: 'generated-article',
    categories: ['AI', 'Technology'],
    tags: ['test'],
    metadata: {
      wordCount: 500,
      language: 'ja',
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-5-20250929'
    }
  }),

  generateArticleFromURL: jest.fn().mockResolvedValue({
    title: 'Generated from URL',
    content: 'Content generated from URL...',
    excerpt: 'URL based excerpt',
    slug: 'url-based-article',
    categories: ['Web'],
    tags: ['url', 'extraction'],
    metadata: {
      wordCount: 600,
      language: 'ja',
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-5-20250929'
    }
  }),

  extractContentFromURL: jest.fn().mockResolvedValue({
    title: 'Extracted Title',
    content: 'Extracted content from webpage...',
    author: 'Test Author',
    publishedDate: '2024-01-01',
    image: 'https://example.com/image.jpg'
  }),

  testConnection: jest.fn().mockResolvedValue(true),
};

// WordPress GraphQL モック
export const mockWordPressGraphQL = {
  createPostExtended: jest.fn().mockResolvedValue({
    id: 'cG9zdDoxMjM=',
    databaseId: 123,
    title: 'Created Post',
    content: '<p>Post content</p>',
    slug: 'created-post',
    uri: '/created-post',
    status: 'draft'
  }),

  updatePost: jest.fn().mockResolvedValue({
    id: 'cG9zdDoxMjM=',
    databaseId: 123,
    title: 'Updated Post',
    content: '<p>Updated content</p>',
    slug: 'updated-post',
    uri: '/updated-post',
    status: 'publish'
  }),

  testConnection: jest.fn().mockResolvedValue(true),
};

// RSS Parser モック
export const createMockRSSParser = () => {
  const parseURL = jest.fn();

  const Parser = jest.fn().mockImplementation(() => ({
    parseURL
  }));

  return { Parser, parseURL };
};

// Firebase/Firestore モック
export const mockFirestoreOperations = {
  // Collection operations
  collection: jest.fn().mockReturnThis(),

  // Document operations
  doc: jest.fn().mockReturnThis(),

  // CRUD operations
  get: jest.fn().mockResolvedValue({
    empty: false,
    docs: [],
    forEach: jest.fn()
  }),

  add: jest.fn().mockResolvedValue({
    id: 'new-doc-id'
  }),

  set: jest.fn().mockResolvedValue(undefined),

  update: jest.fn().mockResolvedValue(undefined),

  delete: jest.fn().mockResolvedValue(undefined),

  // Query operations
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),

  // Snapshot operations
  data: jest.fn().mockReturnValue({}),
  exists: jest.fn().mockReturnValue(true),
};

// Article Extractor モック
export const mockArticleExtractor = {
  extract: jest.fn().mockResolvedValue({
    title: 'Extracted Article Title',
    content: 'Extracted article content with full text...',
    author: 'Article Author',
    published: '2024-01-01T00:00:00Z',
    image: 'https://example.com/article-image.jpg',
    description: 'Article description',
    source: 'https://example.com/original-article'
  })
};

// モックのリセット用ヘルパー
export const resetAllMocks = () => {
  jest.clearAllMocks();
  jest.resetModules();
};

// モック設定用ヘルパー
export const setupMocksForService = (service: string) => {
  switch (service) {
    case 'rss-collection':
      jest.mock('rss-parser', () => createMockRSSParser());
      jest.mock('../../lib/services/rss-feed.service');
      break;

    case 'article-generation':
      jest.mock('../../lib/services/claude-api.service', () => mockClaudeAPI);
      jest.mock('../../lib/services/wordpress-graphql.service', () => mockWordPressGraphQL);
      break;

    case 'firebase':
      jest.mock('firebase/firestore', () => mockFirestoreOperations);
      jest.mock('firebase-admin/firestore', () => mockFirestoreOperations);
      break;

    default:
      break;
  }
};

// テストケース用データセット
export const testDataSets = {
  // 日本語記事データセット
  japaneseArticles: [
    {
      title: 'テストプログラミング記事',
      description: 'これはテスト用の日本語記事です',
      content: 'プログラミングに関する詳細なテスト内容',
    },
    {
      title: '技術ニュース速報',
      description: '最新のIT技術に関するニュース',
      content: '人工知能とクラウドコンピューティングの進化',
    },
  ],

  // 英語記事データセット
  englishArticles: [
    {
      title: 'English Programming Article',
      description: 'This is an English test article',
      content: 'Detailed content about programming in English',
    },
    {
      title: 'Tech News Update',
      description: 'Latest technology news and updates',
      content: 'AI and cloud computing evolution',
    },
  ],

  // 混合言語記事データセット
  mixedArticles: [
    {
      title: 'Hybrid Tech Article ハイブリッド技術',
      description: 'Mixed language content 混合言語コンテンツ',
      content: 'This article contains both English and 日本語',
    },
  ],

  // 不完全データセット（エラーテスト用）
  incompleteArticles: [
    {
      title: '',
      description: 'Missing title',
      content: 'Content without title',
    },
    {
      title: 'No link article',
      description: 'Article without link',
      // link property missing
    },
    {
      // all properties missing
    },
  ],
};