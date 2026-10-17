/**
 * Subpage Detection Types
 * 下層ページ検出用の型定義
 */

// ===================================
// コスト追跡用の型
// ===================================

/**
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

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
  /** Model used for AI detection (only when detectionMethods includes 'ai') */
  model?: string;
  /** Token usage statistics for cost tracking (only when AI was used) */
  usage?: TokenUsage;
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
  /**
   * 短辺がこれ未満の画像は載せない (アイコン・見出しの帯など)。枚数の上限は設けない (2026-10-13 BOSS 決定)。
   * HTML の width / height 属性があれば取得の前に、無ければ取得して実際の画素数で判定する
   */
  min_short_side: number;
  /** R2 に上げる前の加工 (`process-article-image.ts`) */
  upload: ImageUploadConfig;
  /** アイキャッチの代わりの画像を選ぶときの「横長」(幅 ÷ 高さ がこれ以上) */
  eyecatch_landscape_ratio: number;
  exclude_patterns: string[];
  /**
   * 会場の案内ページで、ノベルティの画像とみなす代替テキストの語 (例: 特典 / ノベルティ)。
   * 当たった画像には除外パターンを当てない (代替テキストが根拠になるため。LTR は特典の画像のファイル名に banner を含む)
   */
  novelty_alt_keywords?: string[];
}

/** R2 に上げる前の画像の加工 (store-url-patterns.yaml の image_extraction.upload) */
export interface ImageUploadConfig {
  /** 幅がこれを超える画像は縮める */
  max_width: number;
  /** WebP の品質。出来上がりが max_bytes を超えたら quality_step ずつ下げ、min_quality で止める */
  webp_quality: number;
  webp_min_quality: number;
  quality_step: number;
  max_bytes: number;
  /** 高さが幅の split_ratio 倍を超える画像は、上から高さ segment_height で分割する (縮めた後の寸法で判定) */
  split_ratio: number;
  segment_height: number;
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
