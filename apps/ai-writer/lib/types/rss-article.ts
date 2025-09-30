// RSS記事エントリの型定義
export interface RssArticleEntry {
  title: string;
  link: string;
  description?: string;
  content?: string;
  pubDate?: string;
  categories?: string[];
  guid?: string;
  source?: {
    feedId: string;
    feedTitle?: string;
    feedUrl: string;
  };
}

// 妥当性チェック結果
export interface ArticleValidationResult {
  isValid: boolean;
  reasons: string[];
  score: number; // 0-100の妥当性スコア
}

// RSS記事収集の設定（フィード個別の妥当性設定を使用するため、グローバル validation は削除）
export interface RssCollectionConfig {
  maxArticlesPerFeed?: number;
  // フィード個別の ValidationConfig を使用するため、ここでは妥当性設定は不要
}

// RSS記事収集結果
export interface RssCollectionResult {
  totalFeeds: number;
  totalArticles: number;
  validArticles: number;
  invalidArticles: number;
  articles: RssArticleEntry[];
  errors: string[];
  processedAt: Date;
}

// 記事生成状況
export interface ArticleProcessingStatus {
  articleUrl: string;
  status: 'pending' | 'validating' | 'fetching-content' | 'generating' | 'publishing' | 'completed' | 'failed';
  error?: string;
  generatedPostId?: string;
  processedAt?: Date;
}