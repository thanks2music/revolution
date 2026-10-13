/**
 * ImageExtractorService
 * HTMLから画像URLを抽出するサービス（Claude APIのフォールバック処理）
 */

import * as cheerio from 'cheerio';

export interface ExtractedImages {
  eyecatch?: string | null;
  menu?: string[] | null;
  novelty?: string[] | null;
  goods?: string[] | null;
  ogp?: string | null;
  all?: string[];
}

/**
 * 画像抽出サービス
 */
export class ImageExtractorService {
  /**
   * HTMLから画像URLを抽出
   * @param html HTML文字列
   * @param sourceUrl ソースURL（相対URLの解決に使用）
   * @returns 抽出された画像URL
   */
  async extractImagesFromHtml(
    html: string,
    sourceUrl: string
  ): Promise<ExtractedImages> {
    try {
      const $ = cheerio.load(html);
      const baseUrl = new URL(sourceUrl);

      // 1. OGP画像を取得
      const ogpImage = this.extractOgpImage($);

      // 2. 記事内の画像を全て取得
      const allImages: string[] = [];
      $('img').each((_, element) => {
        const src = $(element).attr('src');
        if (src) {
          // 相対URLを絶対URLに変換
          try {
            const absoluteUrl = new URL(src, baseUrl).href;
            // 小さいアイコンやロゴを除外（サイズフィルタ）
            const width = $(element).attr('width');
            const height = $(element).attr('height');
            if (
              !width ||
              !height ||
              (parseInt(width) >= 200 && parseInt(height) >= 200)
            ) {
              allImages.push(absoluteUrl);
            }
          } catch (error) {
            console.warn(`Invalid image URL: ${src}`);
          }
        }
      });

      console.log(`📷 Extracted ${allImages.length} images from HTML`);

      // 3. 画像を分類（ヒューリスティック）
      const eyecatch = ogpImage || allImages[0] || null;
      const menu = allImages.slice(0, 3).length > 0 ? allImages.slice(0, 3) : null;
      const novelty = allImages.slice(3, 6).length > 0 ? allImages.slice(3, 6) : null;
      const goods = allImages.slice(6, 9).length > 0 ? allImages.slice(6, 9) : null;

      return {
        eyecatch,
        menu,
        novelty,
        goods,
        ogp: ogpImage,
        all: allImages,
      };
    } catch (error) {
      console.error('Failed to extract images from HTML:', error);
      return {
        eyecatch: null,
        menu: null,
        novelty: null,
        goods: null,
        ogp: null,
        all: [],
      };
    }
  }

  /**
   * OGP画像を抽出
   * @param $ Cheerio instance
   * @returns OGP画像URL
   */
  private extractOgpImage($: cheerio.CheerioAPI): string | null {
    // OGP画像を取得
    const ogpImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content');

    return ogpImage || null;
  }

  /**
   * 画像URLの配列をフィルタリング（重複削除、無効URLの除外）
   * @param urls 画像URL配列
   * @returns フィルタリング後の配列
   */
  filterImageUrls(urls: string[]): string[] {
    const uniqueUrls = Array.from(new Set(urls));

    return uniqueUrls.filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * 画像URLが有効かチェック
   * @param url 画像URL
   * @returns 有効な場合true
   */
  isValidImageUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const ext = parsedUrl.pathname.toLowerCase();
      return (
        ext.endsWith('.jpg') ||
        ext.endsWith('.jpeg') ||
        ext.endsWith('.png') ||
        ext.endsWith('.gif') ||
        ext.endsWith('.webp')
      );
    } catch {
      return false;
    }
  }

  /**
   * article要素内の最初の画像を抽出（アイキャッチ用）
   * @param html HTML文字列
   * @param sourceUrl ソースURL（相対URLの解決に使用）
   * @returns 最初の画像URL、見つからない場合はnull
   */
  extractFeaturedImageFromArticle(
    html: string,
    sourceUrl: string
  ): string | null {
    try {
      const $ = cheerio.load(html);
      const baseUrl = new URL(sourceUrl);

      // article要素内の最初のimg要素を取得
      const firstImg = $('article img').first();

      if (firstImg.length === 0) {
        console.log('📷 No image found in <article> element');
        return null;
      }

      const src = firstImg.attr('src') || firstImg.attr('data-src');
      if (!src) {
        console.log('📷 Image element found but no src attribute');
        return null;
      }

      // 相対URLを絶対URLに変換
      try {
        const absoluteUrl = new URL(src, baseUrl).href;
        console.log(`📷 Extracted featured image from article: ${absoluteUrl}`);
        return absoluteUrl;
      } catch (error) {
        console.warn(`Invalid image URL in article: ${src}`, error);
        return null;
      }
    } catch (error) {
      console.error('Failed to extract featured image from article:', error);
      return null;
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const imageExtractorService = new ImageExtractorService();
