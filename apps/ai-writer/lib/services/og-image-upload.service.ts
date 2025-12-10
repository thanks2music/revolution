/**
 * OGImageUploadService
 *
 * OG画像（アイキャッチ）のR2アップロードを担当するサービス
 *
 * @description
 * 公式サイトから取得したOG画像をCloudflare R2にアップロードし、
 * カスタムドメインのURLを返します。
 *
 * 処理フロー:
 * 1. HTMLからOGP画像URLを抽出 (imageExtractorService)
 * 2. 画像をダウンロード
 * 3. R2にアップロード (r2StorageService)
 * 4. 公開URLを返却
 */

import { imageExtractorService } from './image-extractor.service';
import { getR2StorageService, type R2UploadResult } from './r2-storage.service';

/**
 * OG画像アップロード結果
 */
export interface OgImageUploadResult {
  /** アップロード成功 */
  success: boolean;
  /** R2公開URL（成功時） */
  r2Url?: string;
  /** 元のOG画像URL */
  originalUrl?: string;
  /** R2オブジェクトキー */
  key?: string;
  /** ファイルサイズ（バイト） */
  size?: number;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/**
 * OG画像アップロードオプション
 */
export interface OgImageUploadOptions {
  /** 保存先フォルダ（デフォルト: 'og-images'） */
  folder?: string;
  /** 記事スラッグ（フォルダ構成に使用） */
  articleSlug?: string;
  /** ドライランモード（実際にはアップロードしない） */
  dryRun?: boolean;
}

/**
 * OG画像アップロードサービス
 */
export class OgImageUploadService {
  /**
   * HTMLからOG画像を抽出してR2にアップロード
   *
   * @param html HTMLコンテンツ
   * @param sourceUrl ソースURL（相対URL解決用）
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadFromHtml(
    html: string,
    sourceUrl: string,
    options: OgImageUploadOptions = {}
  ): Promise<OgImageUploadResult> {
    const { folder = 'og-images', articleSlug, dryRun = false } = options;

    try {
      console.log('🖼️ OG画像の抽出を開始...');

      // 1. HTMLからOGP画像を抽出
      const extractedImages = await imageExtractorService.extractImagesFromHtml(
        html,
        sourceUrl
      );

      const ogImageUrl = extractedImages.ogp || extractedImages.eyecatch;

      if (!ogImageUrl) {
        console.log('⚠️ OG画像が見つかりませんでした');
        return {
          success: false,
          error: 'OG画像が見つかりませんでした',
        };
      }

      console.log(`📷 OG画像を検出: ${ogImageUrl}`);

      // ドライランモードの場合はアップロードをスキップ
      if (dryRun) {
        console.log('🔍 [DRY RUN] アップロードをスキップします');
        return {
          success: true,
          originalUrl: ogImageUrl,
          r2Url: `[DRY RUN] https://images.anime-events.com/${folder}/${articleSlug || 'article'}/og-image.jpg`,
        };
      }

      // 2. R2にアップロード
      const targetFolder = articleSlug ? `${folder}/${articleSlug}` : folder;
      const r2Service = getR2StorageService();
      const result = await r2Service.uploadFromUrl(ogImageUrl, targetFolder);

      console.log(`✅ OG画像をR2にアップロード完了: ${result.url}`);

      return {
        success: true,
        r2Url: result.url,
        originalUrl: ogImageUrl,
        key: result.key,
        size: result.size,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ OG画像のアップロードに失敗:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * URLから直接OG画像をアップロード
   *
   * @param imageUrl 画像URL
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadFromUrl(
    imageUrl: string,
    options: OgImageUploadOptions = {}
  ): Promise<OgImageUploadResult> {
    const { folder = 'og-images', articleSlug, dryRun = false } = options;

    try {
      console.log(`🖼️ OG画像のアップロードを開始: ${imageUrl}`);

      // URLの検証
      if (!imageUrl || !imageUrl.startsWith('http')) {
        return {
          success: false,
          error: '無効な画像URLです',
        };
      }

      // ドライランモードの場合はアップロードをスキップ
      if (dryRun) {
        console.log('🔍 [DRY RUN] アップロードをスキップします');
        return {
          success: true,
          originalUrl: imageUrl,
          r2Url: `[DRY RUN] https://images.anime-events.com/${folder}/${articleSlug || 'article'}/og-image.jpg`,
        };
      }

      // R2にアップロード
      const targetFolder = articleSlug ? `${folder}/${articleSlug}` : folder;
      const r2Service = getR2StorageService();
      const result = await r2Service.uploadFromUrl(imageUrl, targetFolder);

      console.log(`✅ OG画像をR2にアップロード完了: ${result.url}`);

      return {
        success: true,
        r2Url: result.url,
        originalUrl: imageUrl,
        key: result.key,
        size: result.size,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ OG画像のアップロードに失敗:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * ページURLからOG画像を取得してアップロード
   *
   * @param pageUrl ページURL
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadFromPageUrl(
    pageUrl: string,
    options: OgImageUploadOptions = {}
  ): Promise<OgImageUploadResult> {
    try {
      console.log(`🌐 ページからOG画像を取得: ${pageUrl}`);

      // ページのHTMLを取得
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RevolutionBot/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`ページの取得に失敗: ${response.status}`);
      }

      const html = await response.text();

      // HTMLからOG画像を抽出してアップロード
      return this.uploadFromHtml(html, pageUrl, options);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ ページからのOG画像取得に失敗:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

/**
 * シングルトンインスタンス
 */
let ogImageUploadServiceInstance: OgImageUploadService | null = null;

export function getOgImageUploadService(): OgImageUploadService {
  if (!ogImageUploadServiceInstance) {
    ogImageUploadServiceInstance = new OgImageUploadService();
  }
  return ogImageUploadServiceInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
export function resetOgImageUploadService(): void {
  ogImageUploadServiceInstance = null;
}

export const ogImageUploadService = {
  get instance() {
    return getOgImageUploadService();
  },
};
