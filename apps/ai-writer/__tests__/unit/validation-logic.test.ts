/**
 * 妥当性検証ロジックの網羅的テスト
 *
 * テスト対象：
 * - キーワードマッチング (AND/OR ロジック)
 * - 日本語判定
 * - スコア計算
 * - 妥当性判定
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import RssArticleCollectionService from '../../lib/services/rss-article-collection.service';
import type { RssFeed, ValidationConfig } from '../../lib/types/rss-feed';
import type { RssArticleEntry } from '../../lib/types/rss-article';

// RssArticleCollectionServiceのprivateメソッドをテスト用に公開
class TestableRssArticleCollectionService extends RssArticleCollectionService {
  public testValidateArticle(article: RssArticleEntry, feed: RssFeed) {
    // @ts-ignore: Accessing private method for testing
    return this.validateArticle(article, feed);
  }

  public testCheckKeywords(article: RssArticleEntry, config: ValidationConfig) {
    // @ts-ignore: Accessing private method for testing
    return this.checkKeywords(article, config);
  }

  public testCheckJapanese(article: RssArticleEntry) {
    // @ts-ignore: Accessing private method for testing
    return this.checkJapanese(article);
  }
}

describe('妥当性検証ロジック', () => {
  let service: TestableRssArticleCollectionService;

  beforeEach(() => {
    service = new TestableRssArticleCollectionService();
  });

  // テスト用の基本フィード設定
  const createFeed = (validationConfig: ValidationConfig): RssFeed => ({
    id: 'test-feed',
    url: 'https://test.com/rss',
    title: 'Test Feed',
    isActive: true,
    validationConfig,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test-user'
  });

  // テスト用の基本記事
  const createArticle = (overrides = {}): RssArticleEntry => ({
    title: 'Test Article',
    link: 'https://test.com/article',
    description: 'Test description',
    content: 'Test content',
    pubDate: '2024-01-01',
    categories: [],
    guid: 'test-guid',
    source: {
      feedId: 'test-feed',
      feedTitle: 'Test Feed',
      feedUrl: 'https://test.com/rss'
    },
    ...overrides
  });

  describe('キーワードマッチング - ORロジック', () => {
    const orConfig: ValidationConfig = {
      keywords: ['プログラミング', 'テクノロジー', 'AI'],
      keywordLogic: 'OR',
      requireJapanese: false,
      minScore: 50,
      isEnabled: true
    };

    it('いずれか1つのキーワードが含まれていれば true', () => {
      const article = createArticle({
        title: 'プログラミング入門',
        description: '初心者向けの内容',
        content: 'コードの書き方'
      });

      const result = service.testCheckKeywords(article, orConfig);
      expect(result).toBe(true);
    });

    it('複数のキーワードが含まれていても true', () => {
      const article = createArticle({
        title: 'AIプログラミング',
        description: 'テクノロジーの最前線',
        content: '人工知能の実装方法'
      });

      const result = service.testCheckKeywords(article, orConfig);
      expect(result).toBe(true);
    });

    it('どのキーワードも含まれていなければ false', () => {
      const article = createArticle({
        title: '料理レシピ',
        description: 'おいしい料理の作り方',
        content: '材料と手順'
      });

      const result = service.testCheckKeywords(article, orConfig);
      expect(result).toBe(false);
    });

    it('大文字小文字を無視してマッチング', () => {
      const article = createArticle({
        title: 'PROGRAMMING Guide',
        description: 'technology news',
        content: 'ai development'
      });

      const englishConfig: ValidationConfig = {
        ...orConfig,
        keywords: ['programming', 'technology', 'ai']
      };

      const result = service.testCheckKeywords(article, englishConfig);
      expect(result).toBe(true);
    });
  });

  describe('キーワードマッチング - ANDロジック', () => {
    const andConfig: ValidationConfig = {
      keywords: ['コラボ', 'カフェ'],
      keywordLogic: 'AND',
      requireJapanese: false,
      minScore: 50,
      isEnabled: true
    };

    it('すべてのキーワードが含まれていれば true', () => {
      const article = createArticle({
        title: 'アニメコラボカフェ開催',
        description: '期間限定のコラボレーション',
        content: 'カフェメニューの紹介'
      });

      const result = service.testCheckKeywords(article, andConfig);
      expect(result).toBe(true);
    });

    it('一部のキーワードのみでは false', () => {
      const article = createArticle({
        title: 'カフェ新規オープン',
        description: '素敵なカフェの紹介',
        content: 'メニューとアクセス'
      });

      const result = service.testCheckKeywords(article, andConfig);
      expect(result).toBe(false);
    });

    it('すべてのキーワードが異なるフィールドに分散していても true', () => {
      const article = createArticle({
        title: 'コラボ企画発表',
        description: 'テーマカフェとして',
        content: '詳細情報'
      });

      const result = service.testCheckKeywords(article, andConfig);
      expect(result).toBe(true);
    });
  });

  describe('キーワードマッチング - エッジケース', () => {
    it('空のキーワードリストは常に true', () => {
      const config: ValidationConfig = {
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 50,
        isEnabled: true
      };

      const article = createArticle({
        title: '何でもいい記事',
        description: '任意の内容'
      });

      const result = service.testCheckKeywords(article, config);
      expect(result).toBe(true);
    });

    it('部分一致でもマッチング', () => {
      const config: ValidationConfig = {
        keywords: ['プログラ'],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 50,
        isEnabled: true
      };

      const article = createArticle({
        title: 'プログラミング学習'
      });

      const result = service.testCheckKeywords(article, config);
      expect(result).toBe(true);
    });
  });

  describe('日本語判定', () => {
    it('ひらがなが含まれていれば日本語と判定', () => {
      const article = createArticle({
        title: 'これはテストです',
        description: 'English description'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(true);
    });

    it('カタカナが含まれていれば日本語と判定', () => {
      const article = createArticle({
        title: 'Test Article',
        description: 'プログラミング'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(true);
    });

    it('漢字が含まれていれば日本語と判定', () => {
      const article = createArticle({
        title: '技術記事',
        description: 'Technology'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(true);
    });

    it('英語のみの場合は日本語ではないと判定', () => {
      const article = createArticle({
        title: 'English Only Title',
        description: 'This is pure English content'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(false);
    });

    it('数字と記号のみの場合は日本語ではないと判定', () => {
      const article = createArticle({
        title: '123456',
        description: '!@#$%^&*()'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(false);
    });

    it('混合言語の場合は日本語と判定', () => {
      const article = createArticle({
        title: 'JavaScript入門',
        description: 'Web開発'
      });

      const result = service.testCheckJapanese(article);
      expect(result).toBe(true);
    });
  });

  describe('妥当性検証総合テスト', () => {
    it('検証無効設定の場合は常に妥当と判定', () => {
      const feed = createFeed({
        keywords: ['test'],
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 100,
        isEnabled: false // 無効化
      });

      const article = createArticle({
        title: 'Invalid article',
        description: 'No keywords, no Japanese'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.isValid).toBe(true);
      expect(result.score).toBe(100);
    });

    it('日本語必須 + キーワードマッチで妥当と判定', () => {
      const feed = createFeed({
        keywords: ['テスト'],
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 70,
        isEnabled: true
      });

      const article = createArticle({
        title: 'テストプログラム',
        description: '日本語の説明',
        content: 'プログラミングのテスト'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });

    it('日本語なしでキーワードマッチだけでは不足', () => {
      const feed = createFeed({
        keywords: ['test'],
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 70,
        isEnabled: true
      });

      const article = createArticle({
        title: 'Test Program',
        description: 'English test description'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.isValid).toBe(false);
      expect(result.reasons).toContain('日本語記事ではありません');
    });

    it('スコアが最低値未満の場合は無効', () => {
      const feed = createFeed({
        keywords: ['存在しないキーワード'], // マッチしないキーワード
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 100, // 非常に高い最低スコア
        isEnabled: true
      });

      const article = createArticle({
        title: 'Simple Article',
        link: 'https://test.com'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.isValid).toBe(false);
      expect(result.score).toBeLessThan(100); // キーワードマッチなしで40点 (0+30+10)
    });

    it('タイトルとリンクがない場合は減点', () => {
      const feed = createFeed({
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 50,
        isEnabled: true
      });

      const articleNoTitle = createArticle({
        title: '',
        link: 'https://test.com'
      });

      const result1 = service.testValidateArticle(articleNoTitle, feed);
      expect(result1.reasons).toContain('タイトルまたはリンクが不足しています');

      const articleNoLink = createArticle({
        title: 'Test',
        link: ''
      });

      const result2 = service.testValidateArticle(articleNoLink, feed);
      expect(result2.reasons).toContain('タイトルまたはリンクが不足しています');
    });

    it('複雑な条件の組み合わせテスト', () => {
      const feed = createFeed({
        keywords: ['AI', '人工知能', '機械学習'],
        keywordLogic: 'OR',
        requireJapanese: true,
        minScore: 80,
        isEnabled: true
      });

      // 成功パターン: 日本語 + キーワード
      const validArticle = createArticle({
        title: 'AI技術の進化',
        description: '人工知能と機械学習の最新動向',
        content: '詳細な技術解説'
      });

      const validResult = service.testValidateArticle(validArticle, feed);
      expect(validResult.isValid).toBe(true);

      // 失敗パターン: 英語のみ
      const invalidArticle1 = createArticle({
        title: 'AI Technology Evolution',
        description: 'Latest trends in artificial intelligence'
      });

      const invalidResult1 = service.testValidateArticle(invalidArticle1, feed);
      expect(invalidResult1.isValid).toBe(false);

      // 失敗パターン: 日本語だがキーワードなし
      const invalidArticle2 = createArticle({
        title: 'プログラミング基礎',
        description: 'コーディングの基本'
      });

      const invalidResult2 = service.testValidateArticle(invalidArticle2, feed);
      expect(invalidResult2.isValid).toBe(false);
    });
  });

  describe('スコア計算の検証', () => {
    it('キーワードマッチで60点加算', () => {
      const feed = createFeed({
        keywords: ['test'],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 0,
        isEnabled: true
      });

      const article = createArticle({
        title: 'test article',
        link: 'https://test.com'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('日本語で30点加算', () => {
      const feed = createFeed({
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 0,
        isEnabled: true
      });

      const article = createArticle({
        title: '日本語タイトル',
        link: 'https://test.com'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.score).toBeGreaterThanOrEqual(90); // 60(キーワード空) + 30(日本語)
    });

    it('タイトルとリンクで10点加算', () => {
      const feed = createFeed({
        keywords: [],
        keywordLogic: 'OR',
        requireJapanese: false,
        minScore: 0,
        isEnabled: true
      });

      const article = createArticle({
        title: 'Title',
        link: 'https://test.com'
      });

      const result = service.testValidateArticle(article, feed);
      expect(result.score).toBe(100); // 60(キーワード空) + 30(日本語不要) + 10(完全性)
    });
  });
});