/**
 * Category Image Extractor Service
 * カテゴリ別に画像を抽出するサービス
 *
 * @description
 * SubpageDetectorService で検出されたカテゴリ別URLから
 * 各ページの画像を抽出し、カテゴリごとに整理して返す。
 */

import * as cheerio from 'cheerio';
import type { CategoryUrls } from '@/lib/types/subpage-detection';
import { getConfigLoaderService, ConfigLoaderService } from './config-loader.service';

/**
 * カテゴリ別画像抽出結果
 */
export interface CategoryImages {
  /** アイキャッチ画像URL（OGP画像 or トップページの最初の画像） */
  eyecatch: string | null;
  /** メニュー画像URL配列 */
  menu: string[];
  /** ノベルティ画像URL配列 */
  novelty: string[];
  /** グッズ画像URL配列 */
  goods: string[];
  /** 各カテゴリの取得元URL */
  sources: {
    eyecatch?: string;
    menu?: string;
    novelty?: string;
    goods?: string;
  };
  /** 全画像URL（重複排除済み） */
  all: string[];
}

/**
 * ページ画像抽出結果
 */
interface PageImagesResult {
  images: string[];
  ogpImage: string | null;
}

/**
 * Category Image Extractor Service
 */
export class CategoryImageExtractorService {
  private configLoader: ConfigLoaderService;

  constructor(configLoader?: ConfigLoaderService) {
    this.configLoader = configLoader || getConfigLoaderService();
  }

  /**
   * カテゴリ別に画像を抽出
   *
   * @param topPageUrl トップページURL（フォールバック & OGP取得用）
   * @param topPageHtml トップページのHTML（既に取得済みの場合）
   * @param categoryUrls カテゴリ別URLマップ（SubpageDetectorService の出力）
   * @returns カテゴリ別画像
   */
  async extractCategoryImages(
    topPageUrl: string,
    topPageHtml: string | null,
    categoryUrls: CategoryUrls
  ): Promise<CategoryImages> {
    console.log('[CategoryImageExtractor] カテゴリ別画像抽出開始');

    // 設定を読み込み
    const config = await this.configLoader.loadStoreUrlPatterns();
    const imageConfig = config.image_extraction;

    const result: CategoryImages = {
      eyecatch: null,
      menu: [],
      novelty: [],
      goods: [],
      sources: {},
      all: [],
    };

    const allImages = new Set<string>();

    // 1. トップページからOGP画像とアイキャッチを取得
    if (topPageHtml) {
      const topPageResult = this.extractImagesFromHtml(
        topPageHtml,
        topPageUrl,
        imageConfig
      );
      result.eyecatch = topPageResult.ogpImage || topPageResult.images[0] || null;
      result.sources.eyecatch = topPageUrl;

      // トップページの画像を all に追加
      topPageResult.images.forEach((img) => allImages.add(img));
    }

    // 2. 各カテゴリの下層ページから画像を抽出
    const categories = ['menu', 'novelty', 'goods'] as const;

    for (const category of categories) {
      const urls = categoryUrls[category];

      if (urls && urls.length > 0) {
        // 最初のURLのみを使用（複数ある場合）
        const targetUrl = urls[0];

        try {
          console.log(`[CategoryImageExtractor] ${category}: ${targetUrl} から画像抽出`);

          const html = await this.fetchPage(targetUrl);
          const pageResult = this.extractImagesFromHtml(html, targetUrl, imageConfig);

          // 最大枚数まで取得
          const limitedImages = pageResult.images.slice(
            0,
            imageConfig.max_images_per_category
          );

          result[category] = limitedImages;
          result.sources[category] = targetUrl;

          // all に追加
          limitedImages.forEach((img) => allImages.add(img));

          console.log(
            `[CategoryImageExtractor] ${category}: ${limitedImages.length}枚の画像を抽出`
          );
        } catch (error) {
          console.warn(
            `[CategoryImageExtractor] ${category}: ページ取得失敗 (${targetUrl})`,
            error
          );
        }
      }
    }

    // 3. 下層ページがない場合はトップページから推測（フォールバック）
    if (
      result.menu.length === 0 &&
      result.novelty.length === 0 &&
      result.goods.length === 0 &&
      topPageHtml
    ) {
      console.log('[CategoryImageExtractor] 下層ページなし、トップページからフォールバック');

      const topPageResult = this.extractImagesFromHtml(
        topPageHtml,
        topPageUrl,
        imageConfig
      );

      // ヒューリスティックに分割（既存ロジックと同様）
      const images = topPageResult.images;
      const maxPerCategory = imageConfig.max_images_per_category;

      result.menu = images.slice(0, maxPerCategory);
      result.novelty = images.slice(maxPerCategory, maxPerCategory * 2);
      result.goods = images.slice(maxPerCategory * 2, maxPerCategory * 3);

      result.sources.menu = topPageUrl;
      result.sources.novelty = topPageUrl;
      result.sources.goods = topPageUrl;

      images.forEach((img) => allImages.add(img));
    }

    result.all = Array.from(allImages);

    console.log('[CategoryImageExtractor] 抽出結果:', {
      eyecatch: result.eyecatch ? '取得済み' : 'なし',
      menu: result.menu.length,
      novelty: result.novelty.length,
      goods: result.goods.length,
      total: result.all.length,
    });

    return result;
  }

  /**
   * ページをフェッチ
   */
  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * HTMLから画像を抽出
   */
  private extractImagesFromHtml(
    html: string,
    sourceUrl: string,
    config: {
      max_images_per_category: number;
      min_image_size: { width: number; height: number };
      exclude_patterns: string[];
    }
  ): PageImagesResult {
    const $ = cheerio.load(html);
    const baseUrl = new URL(sourceUrl);

    // OGP画像を取得
    const ogpImage = this.extractOgpImage($);

    // 記事内の画像を全て取得
    const images: string[] = [];
    const excludeRegex = new RegExp(config.exclude_patterns.join('|'), 'i');

    $('img').each((_, element) => {
      const src =
        $(element).attr('src') ||
        $(element).attr('data-src') ||
        $(element).attr('data-lazy-src');

      if (!src) return;

      // 除外パターンチェック
      if (excludeRegex.test(src)) {
        return;
      }

      // 絶対URLに変換
      let absoluteUrl: string;
      try {
        absoluteUrl = src.startsWith('http') ? src : new URL(src, baseUrl.origin).href;
      } catch {
        return;
      }

      // サイズフィルタ
      const width = $(element).attr('width');
      const height = $(element).attr('height');

      if (width && height) {
        const w = parseInt(width, 10);
        const h = parseInt(height, 10);

        if (w < config.min_image_size.width || h < config.min_image_size.height) {
          return;
        }
      }

      // 重複チェック
      if (!images.includes(absoluteUrl)) {
        images.push(absoluteUrl);
      }
    });

    return { images, ogpImage };
  }

  /**
   * OGP画像を抽出
   */
  private extractOgpImage($: cheerio.CheerioAPI): string | null {
    const ogpImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content');

    return ogpImage || null;
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _categoryImageExtractorService: CategoryImageExtractorService | null = null;

export function getCategoryImageExtractorService(): CategoryImageExtractorService {
  if (!_categoryImageExtractorService) {
    _categoryImageExtractorService = new CategoryImageExtractorService();
  }
  return _categoryImageExtractorService;
}
