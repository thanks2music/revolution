/**
 * テスト用ヘルパー関数とFirebase Emulator設定
 */

import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, cert } from 'firebase-admin/app';
import { Firestore } from 'firebase-admin/firestore';

// Firebase Emulator接続設定
export const setupFirebaseEmulator = async (): Promise<RulesTestEnvironment> => {
  // 環境変数チェック
  if (!process.env.FIREBASE_USE_EMULATOR) {
    throw new Error('FIREBASE_USE_EMULATOR environment variable must be set to true');
  }

  const testEnv = await initializeTestEnvironment({
    projectId: 'test-project',
    firestore: {
      host: 'localhost',
      port: 8088,
      rules: undefined, // テスト環境ではルールをバイパス
    },
    auth: {
      host: 'localhost',
      port: 9099,
    }
  });

  return testEnv;
};

// Firebase Admin SDK初期化（テスト用）
export const initTestAdmin = () => {
  if (!process.env.FIREBASE_USE_EMULATOR) {
    return null;
  }

  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8088';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

  const app = initializeApp({
    projectId: 'test-project',
  });

  return app;
};

// テストデータクリーンアップ
export const clearFirestoreData = async (testEnv: RulesTestEnvironment) => {
  await testEnv.clearFirestore();
};

// モックデータジェネレーター
export const createMockRssFeed = (overrides = {}) => ({
  id: 'test-feed-id',
  url: 'https://test.example.com/rss.xml',
  title: 'Test RSS Feed',
  description: 'Test RSS Feed Description',
  isActive: true,
  validationConfig: {
    keywords: ['test', 'keyword'],
    keywordLogic: 'OR' as const,
    requireJapanese: false,
    minScore: 50,
    isEnabled: true,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'test-user',
  ...overrides,
});

export const createMockRssArticle = (overrides = {}) => ({
  title: 'Test Article Title',
  link: 'https://test.example.com/article',
  description: 'Test article description',
  content: 'Test article content with test keyword',
  pubDate: '2024-01-01T00:00:00Z',
  categories: ['test'],
  guid: 'test-article-guid',
  source: {
    feedId: 'test-feed-id',
    feedTitle: 'Test Feed',
    feedUrl: 'https://test.example.com/rss.xml',
  },
  ...overrides,
});

// Claude API モックレスポンス
export const createMockClaudeResponse = (overrides = {}) => ({
  title: 'Generated Article Title',
  content: 'Generated article content with comprehensive information...',
  excerpt: 'Article excerpt',
  slug: 'generated-article-slug',
  categories: ['テクノロジー', 'AI'],
  tags: ['Claude', 'AI', 'API'],
  metadata: {
    wordCount: 600,
    language: 'ja',
    generatedAt: new Date().toISOString(),
    model: 'claude-sonnet-4-5-20250929',
  },
  ...overrides,
});

// WordPress GraphQL モックレスポンス
export const createMockWordPressPost = (overrides = {}) => ({
  id: 'cG9zdDoxMjM=',
  databaseId: 123,
  title: 'Test Post Title',
  content: '<p>Test post content</p>',
  slug: 'test-post-slug',
  uri: '/test-post-slug',
  status: 'draft',
  author: {
    node: {
      id: 'dXNlcjox',
      name: 'Test Author',
    }
  },
  ...overrides,
});

// RSS Parser モックレスポンス
export const createMockRssParserResponse = (items = []) => ({
  title: 'Test Feed Title',
  description: 'Test Feed Description',
  link: 'https://test.example.com',
  items: items.length > 0 ? items : [
    {
      title: 'Test Article 1',
      link: 'https://test.example.com/article1',
      description: 'Test article 1 description',
      pubDate: '2024-01-01T00:00:00Z',
      categories: ['test'],
      guid: 'article-1',
      'content:encoded': '<p>Full content of article 1</p>',
    },
    {
      title: 'Test Article 2',
      link: 'https://test.example.com/article2',
      description: 'Test article 2 description',
      pubDate: '2024-01-02T00:00:00Z',
      categories: ['test'],
      guid: 'article-2',
      content: 'Simple content of article 2',
    },
  ],
});