/**
 * Subpage Detection Types
 * 下層ページ検出用の型定義
 */

// ===================================
// 検出結果
// ===================================

/**
 * カテゴリ種別
 */
export type CategoryType = 'menu' | 'novelty' | 'goods';

/**
 * 検出方法
 */
export type DetectionMethod = 'yaml' | 'keyword' | 'ai' | 'none';

/**
 * カテゴリ別URL
 */
export interface CategoryUrls {
  menu?: string[];
  novelty?: string[];
  goods?: string[];
}

/**
 * 下層ページ検出結果
 */
export interface SubpageDetectionResult {
  /** 検出されたカテゴリ別URL */
  categoryUrls: CategoryUrls;
  /** 各カテゴリの検出に使用した方法 */
  detectionMethods: {
    menu?: DetectionMethod;
    novelty?: DetectionMethod;
    goods?: DetectionMethod;
  };
  /** トップページのみか（下層ページが検出されなかった） */
  isTopPageOnly: boolean;
  /** デバッグ情報 */
  _debug?: {
    storeSlug?: string;
    availableLinks: string[];
    yamlMatched?: CategoryUrls;
    keywordMatched?: CategoryUrls;
    aiMatched?: CategoryUrls;
  };
}

// ===================================
// YAML設定の型定義
// ===================================

/**
 * 店舗固有のカテゴリ設定
 */
export interface StorePatternConfig {
  type: 'subpage' | 'store_page';
  pattern: string;
  priority_locations?: string[];
  fallback?: 'first_available' | 'none';
}

/**
 * 店舗固有パターン
 */
export interface StorePatterns {
  [storeSlug: string]: {
    menu?: StorePatternConfig;
    novelty?: StorePatternConfig;
    goods?: StorePatternConfig;
  };
}

/**
 * デフォルトキーワードパターン
 */
export interface DefaultPatternConfig {
  keywords: string[];
  exclude_keywords?: string[];
}

/**
 * デフォルトパターン設定
 */
export interface DefaultPatterns {
  menu: DefaultPatternConfig;
  novelty: DefaultPatternConfig;
  goods: DefaultPatternConfig;
}

/**
 * AI判定フォールバック設定
 */
export interface AiFallbackConfig {
  enabled: boolean;
  prompt_template: string;
}

/**
 * 画像抽出設定
 */
export interface ImageExtractionConfig {
  max_images_per_category: number;
  min_image_size: {
    width: number;
    height: number;
  };
  exclude_patterns: string[];
}

/**
 * store-url-patterns.yaml の全体構造
 */
export interface StoreUrlPatternsConfig {
  stores: StorePatterns;
  default_patterns: DefaultPatterns;
  ai_fallback: AiFallbackConfig;
  image_extraction: ImageExtractionConfig;
}

// ===================================
// brand-slugs.yaml の型定義
// ===================================

/**
 * ブランドスラッグマッピング
 */
export interface BrandSlugsConfig {
  brand_slugs: {
    [storeName: string]: string;
  };
}
