import '@testing-library/jest-dom';
import dotenv from 'dotenv';
import path from 'path';

// テスト環境用の環境変数を読み込み
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// グローバルテスト設定
global.console = {
  ...console,
  // テスト中のconsole.logを静音化（必要に応じて）
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
};

// Next.js環境変数のモック
process.env.NODE_ENV = 'test';
process.env.NEXT_PUBLIC_WP_ENDPOINT = process.env.NEXT_PUBLIC_WP_ENDPOINT || 'http://localhost:8080/graphql';

// Node.js環境でのfetch APIサポート
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// 簡単なfetchモック（undiciを使わない）
global.fetch = jest.fn();
global.Headers = jest.fn();
global.Request = jest.fn();
global.Response = jest.fn();

// Firebase Admin SDKのモック（テスト中は実際のFirebaseに接続しない）
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn(),
  },
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      get: jest.fn(),
      add: jest.fn(),
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      })),
    })),
  })),
}));

// Firebase クライアントSDKのモック
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  getApp: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  addDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(),
  ref: jest.fn(),
  uploadBytes: jest.fn(),
  getDownloadURL: jest.fn(),
}));

// Anthropic Claude APIのモック
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  })),
}));

// RSS Parserのモック
jest.mock('rss-parser', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    parseURL: jest.fn(),
  })),
}));

// Article Extractorのモック
jest.mock('@extractus/article-extractor', () => ({
  extract: jest.fn(),
}));

// カスタムマッチャーの追加
expect.extend({
  toBeValidRSSFeed(received) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.url === 'string' &&
      typeof received.isActive === 'boolean';

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid RSS feed`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid RSS feed`,
        pass: false,
      };
    }
  },
});