import Parser from 'rss-parser';
import { RssFeedService } from './rss-feed.service';
import type { RssFeed, ValidationConfig } from '../types/rss-feed';
import type {
  RssArticleEntry,
  ArticleValidationResult,
  RssCollectionConfig,
  RssCollectionResult
} from '../types/rss-article';

export class RssArticleCollectionService {
  private parser: Parser;
  private config: RssCollectionConfig;

  constructor(config?: Partial<RssCollectionConfig>) {
    this.parser = new Parser({
      customFields: {
        item: ['content', 'content:encoded', 'description']
      }
    });

    // デフォルト設定（フィード個別の妥当性設定を使用するため、グローバル validation は削除）
    this.config = {
      maxArticlesPerFeed: 10,
      ...config
    };
  }

  /**
   * 登録済みRSSフィードから記事を収集
   */
  async collectArticles(): Promise<RssCollectionResult> {
    console.log('Starting RSS article collection...');

    const result: RssCollectionResult = {
      totalFeeds: 0,
      totalArticles: 0,
      validArticles: 0,
      invalidArticles: 0,
      articles: [],
      errors: [],
      processedAt: new Date()
    };

    try {
      // アクティブなRSSフィードを取得
      const feeds = await RssFeedService.listFeeds(true);
      result.totalFeeds = feeds.length;

      console.log(`Found ${feeds.length} active RSS feeds`);

      if (feeds.length === 0) {
        console.log('No active RSS feeds found');
        return result;
      }

      // 各フィードから記事を収集
      for (const feed of feeds) {
        try {
          console.log(`Processing feed: ${feed.title || feed.url}`);
          const articles = await this.processFeed(feed);

          result.totalArticles += articles.length;

          // 妥当性チェック（フィード個別の設定を使用）
          for (const article of articles) {
            const validation = this.validateArticle(article, feed);

            if (validation.isValid) {
              result.articles.push(article);
              result.validArticles++;
              console.log(`✓ Valid article: ${article.title}`);
            } else {
              result.invalidArticles++;
              console.log(`✗ Invalid article: ${article.title} (${validation.reasons.join(', ')})`);
            }
          }

        } catch (error) {
          const errorMsg = `Failed to process feed ${feed.url}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      console.log(`Collection completed: ${result.validArticles}/${result.totalArticles} valid articles from ${result.totalFeeds} feeds`);

    } catch (error) {
      const errorMsg = `RSS collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * 単一のRSSフィードから記事を取得
   */
  private async processFeed(feed: RssFeed): Promise<RssArticleEntry[]> {
    try {
      const parsedFeed = await this.parser.parseURL(feed.url);
      const items = parsedFeed.items || [];

      // 最大記事数でフィルタリング
      const limitedItems = this.config.maxArticlesPerFeed
        ? items.slice(0, this.config.maxArticlesPerFeed)
        : items;

      return limitedItems.map(item => ({
        title: item.title || 'No title',
        link: item.link || '',
        description: item.contentSnippet || item.summary || item.description || '',
        content: item['content:encoded'] || item.content || '',
        pubDate: item.pubDate || item.isoDate || '',
        categories: item.categories || [],
        guid: item.guid || item.id || '',
        source: {
          feedId: feed.id,
          feedTitle: feed.title || parsedFeed.title,
          feedUrl: feed.url
        }
      }));

    } catch (error) {
      console.error(`Failed to parse RSS feed ${feed.url}:`, error);
      throw new Error(`RSS parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 記事の妥当性をチェック（フィード個別の設定を使用）
   */
  private validateArticle(article: RssArticleEntry, feed: RssFeed): ArticleValidationResult {
    const reasons: string[] = [];
    let score = 0;

    // フィードに妥当性設定がない、または無効化されている場合は全て妥当とする
    if (!feed.validationConfig || !feed.validationConfig.isEnabled) {
      return {
        isValid: true,
        reasons: ['妥当性チェックが無効化されています'],
        score: 100
      };
    }

    const validationConfig = feed.validationConfig;

    // 1. キーワードチェック（キーワードが設定されている場合のみ）
    let hasValidKeyword = true; // デフォルトは true（キーワード未設定の場合は通す）
    if (validationConfig.keywords.length > 0) {
      hasValidKeyword = this.checkKeywords(article, validationConfig);
      if (hasValidKeyword) {
        score += 60; // キーワードマッチで60点
      } else {
        reasons.push(`キーワード「${validationConfig.keywords.join(', ')}」が含まれていません`);
      }
    } else {
      score += 60; // キーワード未設定の場合は満点
    }

    // 2. 日本語チェック
    const isJapanese = this.checkJapanese(article);
    if (isJapanese) {
      score += 30; // 日本語で30点
    } else if (validationConfig.requireJapanese) {
      reasons.push('日本語記事ではありません');
    } else {
      score += 30; // 日本語不要の場合は満点
    }

    // 3. 基本的な記事の完全性チェック
    if (article.title && article.link) {
      score += 10; // タイトルとリンクがあれば10点
    } else {
      reasons.push('タイトルまたはリンクが不足しています');
    }

    // 妥当性判定（フィード設定の最低スコアを使用）
    const minScore = validationConfig.minScore || 70;

    // 必須条件チェック
    const hasRequiredKeywords = validationConfig.keywords.length === 0 || hasValidKeyword;
    const hasRequiredJapanese = !validationConfig.requireJapanese || isJapanese;
    const hasMinScore = score >= minScore;

    const isValid = hasRequiredKeywords && hasRequiredJapanese && hasMinScore;

    return {
      isValid,
      reasons,
      score
    };
  }

  /**
   * キーワードチェック（AND/OR ロジック対応）
   */
  private checkKeywords(article: RssArticleEntry, validationConfig: ValidationConfig): boolean {
    const textToCheck = [
      article.title,
      article.description,
      article.content
    ].join(' ').toLowerCase();

    if (validationConfig.keywords.length === 0) {
      return true; // キーワード未設定の場合は true
    }

    if (validationConfig.keywordLogic === 'AND') {
      // すべてのキーワードが含まれている必要がある
      return validationConfig.keywords.every(keyword =>
        textToCheck.includes(keyword.toLowerCase())
      );
    } else {
      // いずれか一つのキーワードが含まれていればOK（OR ロジック）
      return validationConfig.keywords.some(keyword =>
        textToCheck.includes(keyword.toLowerCase())
      );
    }
  }

  /**
   * 日本語文字が含まれているかチェック
   */
  private checkJapanese(article: RssArticleEntry): boolean {
    const textToCheck = article.title + ' ' + (article.description || '');

    // ひらがな、カタカナ、漢字のいずれかが含まれているかチェック
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

    return japaneseRegex.test(textToCheck);
  }

  /**
   * 特定のフィードのみを処理（フィードIDから取得）
   */
  async collectArticlesFromFeed(feedId: string): Promise<RssArticleEntry[]> {
    const feed = await RssFeedService.getFeed(feedId);
    if (!feed) {
      throw new Error(`Feed not found: ${feedId}`);
    }

    if (!feed.isActive) {
      throw new Error(`Feed is not active: ${feedId}`);
    }

    return this.collectArticlesFromFeedObject(feed);
  }

  /**
   * 特定のフィードのみを処理（フィードオブジェクトを直接渡す）
   * API Routeなどサーバーサイドから呼び出す場合に使用
   */
  async collectArticlesFromFeedObject(feed: RssFeed): Promise<RssArticleEntry[]> {
    if (!feed.isActive) {
      throw new Error(`Feed is not active: ${feed.id}`);
    }

    const articles = await this.processFeed(feed);

    // 妥当性チェックを通過した記事のみ返す（フィード設定を使用）
    return articles.filter(article =>
      this.validateArticle(article, feed).isValid
    );
  }

  /**
   * RSS収集設定を更新
   */
  updateConfig(newConfig: Partial<RssCollectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): RssCollectionConfig {
    return { ...this.config };
  }
}

export default RssArticleCollectionService;