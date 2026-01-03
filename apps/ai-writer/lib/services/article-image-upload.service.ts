/**
 * ArticleImageUploadService
 *
 * 記事画像（OG画像 + 本文画像）のR2アップロードを統合管理するサービス
 *
 * @description
 * MDX記事生成パイプラインに統合して使用します。
 * - OG画像（アイキャッチ）のアップロード
 * - 本文内の画像URLを検出してR2にアップロード
 * - アップロード後のURLでMDXコンテンツを置換
 *
 * 処理フロー:
 * 1. HTMLからOGP画像・本文画像を抽出
 * 2. 画像をダウンロードしてR2にアップロード
 * 3. 元URLを公開URLに置換したコンテンツを返却
 */

import { imageExtractorService, type ExtractedImages } from './image-extractor.service';
import { getR2StorageService, type R2UploadResult } from './r2-storage.service';
import { getOgImageUploadService } from './og-image-upload.service';

/**
 * 画像アップロードマッピング
 */
export interface ImageUploadMapping {
  /** 元のURL */
  originalUrl: string;
  /** R2の公開URL */
  r2Url: string;
  /** R2オブジェクトキー */
  key: string;
  /** ファイルサイズ（バイト） */
  size: number;
  /** アップロード成功 */
  success: boolean;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/**
 * 記事画像アップロード結果
 */
export interface ArticleImageUploadResult {
  /** OG画像のアップロード結果 */
  ogImage?: {
    originalUrl: string;
    r2Url?: string;
    success: boolean;
    error?: string;
  };
  /** 本文画像のアップロードマッピング */
  bodyImages: ImageUploadMapping[];
  /** 置換後のコンテンツ（本文画像のURL置換済み） */
  transformedContent?: string;
  /** 統計情報 */
  stats: {
    /** 検出した画像の総数 */
    totalDetected: number;
    /** アップロード成功数 */
    successCount: number;
    /** アップロード失敗数 */
    failureCount: number;
    /** スキップ数 */
    skippedCount: number;
  };
}

/**
 * 記事画像アップロードオプション
 */
export interface ArticleImageUploadOptions {
  /** 記事スラッグ（フォルダ構成に使用） */
  articleSlug: string;
  /** イベントタイプ（フォルダ構成に使用） */
  eventType?: string;
  /** 年（フォルダ構成に使用） */
  year?: number;
  /** ドライランモード（実際にはアップロードしない） */
  dryRun?: boolean;
  /** OG画像をアップロードするか */
  uploadOgImage?: boolean;
  /** 本文画像をアップロードするか */
  uploadBodyImages?: boolean;
  /** 変換対象のコンテンツ（本文画像URL置換用） */
  content?: string;
  /** 除外するURLパターン（正規表現） */
  excludePatterns?: RegExp[];
}

/**
 * 記事画像アップロードサービス
 */
export class ArticleImageUploadService {
  /**
   * HTMLから画像を抽出してR2にアップロード
   *
   * @param html HTMLコンテンツ
   * @param sourceUrl ソースURL（相対URL解決用）
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadFromHtml(
    html: string,
    sourceUrl: string,
    options: ArticleImageUploadOptions
  ): Promise<ArticleImageUploadResult> {
    const {
      articleSlug,
      eventType = 'articles',
      year = new Date().getFullYear(),
      dryRun = false,
      uploadOgImage = true,
      uploadBodyImages = true,
      content,
      excludePatterns = [],
    } = options;

    console.log('🖼️ 記事画像のアップロードを開始...');
    console.log(`  記事スラッグ: ${articleSlug}`);
    console.log(`  ドライランモード: ${dryRun ? 'ON' : 'OFF'}`);

    // 1. HTMLから画像を抽出
    const extractedImages = await imageExtractorService.extractImagesFromHtml(
      html,
      sourceUrl
    );

    console.log(`📷 抽出された画像: OG=${extractedImages.ogp ? '有' : '無'}, 本文=${extractedImages.all?.length || 0}件`);

    const result: ArticleImageUploadResult = {
      bodyImages: [],
      stats: {
        totalDetected: (extractedImages.all?.length || 0) + (extractedImages.ogp ? 1 : 0),
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
      },
    };

    // 2. OG画像のアップロード
    if (uploadOgImage && extractedImages.ogp) {
      console.log('\n📤 OG画像をアップロード中...');
      const ogService = getOgImageUploadService();
      const ogResult = await ogService.uploadFromUrl(extractedImages.ogp, {
        folder: `${eventType}/${year}/${articleSlug}`,
        articleSlug,
        dryRun,
      });

      result.ogImage = {
        originalUrl: extractedImages.ogp,
        r2Url: ogResult.r2Url,
        success: ogResult.success,
        error: ogResult.error,
      };

      if (ogResult.success) {
        result.stats.successCount++;
      } else {
        result.stats.failureCount++;
      }
    }

    // 3. 本文画像のアップロード
    if (uploadBodyImages && extractedImages.all && extractedImages.all.length > 0) {
      console.log(`\n📤 本文画像をアップロード中 (${extractedImages.all.length}件)...`);

      const r2Service = getR2StorageService();
      const folder = `${eventType}/${year}/${articleSlug}`;

      // 重複URL除去
      const uniqueUrls = [...new Set(extractedImages.all)];

      for (const imageUrl of uniqueUrls) {
        // 除外パターンのチェック
        if (this.shouldExclude(imageUrl, excludePatterns)) {
          console.log(`  ⏭️ 除外: ${imageUrl}`);
          result.stats.skippedCount++;
          continue;
        }

        // 既に処理済みのURL（OG画像）はスキップ
        if (result.ogImage?.originalUrl === imageUrl) {
          console.log(`  ⏭️ OG画像と重複: ${imageUrl}`);
          result.stats.skippedCount++;
          continue;
        }

        try {
          if (dryRun) {
            console.log(`  🔍 [DRY RUN] ${imageUrl}`);
            result.bodyImages.push({
              originalUrl: imageUrl,
              r2Url: `[DRY RUN] ${process.env.R2_PUBLIC_URL}/${folder}/${Date.now()}.jpg`,
              key: `${folder}/${Date.now()}.jpg`,
              size: 0,
              success: true,
            });
            result.stats.successCount++;
          } else {
            const uploadResult = await r2Service.uploadFromUrl(imageUrl, folder);
            result.bodyImages.push({
              originalUrl: imageUrl,
              r2Url: uploadResult.url,
              key: uploadResult.key,
              size: uploadResult.size,
              success: true,
            });
            result.stats.successCount++;
            console.log(`  ✅ ${imageUrl} → ${uploadResult.url}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.log(`  ❌ ${imageUrl}: ${errorMessage}`);
          result.bodyImages.push({
            originalUrl: imageUrl,
            r2Url: '',
            key: '',
            size: 0,
            success: false,
            error: errorMessage,
          });
          result.stats.failureCount++;
        }
      }
    }

    // 4. コンテンツ内のURLを置換
    if (content) {
      result.transformedContent = this.transformContent(content, result.bodyImages, result.ogImage);
    }

    console.log('\n📊 アップロード結果:');
    console.log(`  成功: ${result.stats.successCount}`);
    console.log(`  失敗: ${result.stats.failureCount}`);
    console.log(`  スキップ: ${result.stats.skippedCount}`);

    return result;
  }

  /**
   * コンテンツ内の画像URLを置換
   *
   * @param content 元のコンテンツ
   * @param bodyImages 本文画像のマッピング
   * @param ogImage OG画像のマッピング
   * @returns 置換後のコンテンツ
   */
  private transformContent(
    content: string,
    bodyImages: ImageUploadMapping[],
    ogImage?: { originalUrl: string; r2Url?: string; success: boolean }
  ): string {
    let transformed = content;

    // OG画像のURL置換
    if (ogImage?.success && ogImage.r2Url) {
      transformed = transformed.replace(
        new RegExp(this.escapeRegex(ogImage.originalUrl), 'g'),
        ogImage.r2Url
      );
    }

    // 本文画像のURL置換
    for (const mapping of bodyImages) {
      if (mapping.success && mapping.r2Url) {
        transformed = transformed.replace(
          new RegExp(this.escapeRegex(mapping.originalUrl), 'g'),
          mapping.r2Url
        );
      }
    }

    return transformed;
  }

  /**
   * 除外パターンに一致するかチェック
   */
  private shouldExclude(url: string, patterns: RegExp[]): boolean {
    // デフォルトの除外パターン（小さいアイコン、ロゴ等）
    const defaultPatterns = [
      /favicon/i,
      /icon.*\.(ico|png|svg)/i,
      /logo.*\.(png|svg|jpg)/i,
      /sprite/i,
      /spacer/i,
      /pixel\.(gif|png)/i,
      /tracking/i,
      /analytics/i,
      /badge/i,
      /button/i,
    ];

    const allPatterns = [...defaultPatterns, ...patterns];
    return allPatterns.some((pattern) => pattern.test(url));
  }

  /**
   * 正規表現用のエスケープ
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 画像URL配列から直接アップロード
   *
   * @param imageUrls 画像URL配列
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadFromUrls(
    imageUrls: string[],
    options: ArticleImageUploadOptions
  ): Promise<ArticleImageUploadResult> {
    const {
      articleSlug,
      eventType = 'articles',
      year = new Date().getFullYear(),
      dryRun = false,
      content,
      excludePatterns = [],
    } = options;

    console.log(`🖼️ 画像URLから直接アップロード (${imageUrls.length}件)...`);

    const result: ArticleImageUploadResult = {
      bodyImages: [],
      stats: {
        totalDetected: imageUrls.length,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
      },
    };

    const r2Service = getR2StorageService();
    const folder = `${eventType}/${year}/${articleSlug}`;

    // 重複URL除去
    const uniqueUrls = [...new Set(imageUrls)];

    for (const imageUrl of uniqueUrls) {
      // 除外パターンのチェック
      if (this.shouldExclude(imageUrl, excludePatterns)) {
        console.log(`  ⏭️ 除外: ${imageUrl}`);
        result.stats.skippedCount++;
        continue;
      }

      try {
        if (dryRun) {
          console.log(`  🔍 [DRY RUN] ${imageUrl}`);
          result.bodyImages.push({
            originalUrl: imageUrl,
            r2Url: `[DRY RUN] ${process.env.R2_PUBLIC_URL}/${folder}/${Date.now()}.jpg`,
            key: `${folder}/${Date.now()}.jpg`,
            size: 0,
            success: true,
          });
          result.stats.successCount++;
        } else {
          const uploadResult = await r2Service.uploadFromUrl(imageUrl, folder);
          result.bodyImages.push({
            originalUrl: imageUrl,
            r2Url: uploadResult.url,
            key: uploadResult.key,
            size: uploadResult.size,
            success: true,
          });
          result.stats.successCount++;
          console.log(`  ✅ ${imageUrl} → ${uploadResult.url}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`  ❌ ${imageUrl}: ${errorMessage}`);
        result.bodyImages.push({
          originalUrl: imageUrl,
          r2Url: '',
          key: '',
          size: 0,
          success: false,
          error: errorMessage,
        });
        result.stats.failureCount++;
      }
    }

    // コンテンツ内のURLを置換
    if (content) {
      result.transformedContent = this.transformContent(content, result.bodyImages);
    }

    console.log('\n📊 アップロード結果:');
    console.log(`  成功: ${result.stats.successCount}`);
    console.log(`  失敗: ${result.stats.failureCount}`);
    console.log(`  スキップ: ${result.stats.skippedCount}`);

    return result;
  }
}

/**
 * シングルトンインスタンス
 */
let articleImageUploadServiceInstance: ArticleImageUploadService | null = null;

export function getArticleImageUploadService(): ArticleImageUploadService {
  if (!articleImageUploadServiceInstance) {
    articleImageUploadServiceInstance = new ArticleImageUploadService();
  }
  return articleImageUploadServiceInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
export function resetArticleImageUploadService(): void {
  articleImageUploadServiceInstance = null;
}

export const articleImageUploadService = {
  get instance() {
    return getArticleImageUploadService();
  },
};
