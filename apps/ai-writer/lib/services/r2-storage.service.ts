/**
 * R2StorageService
 *
 * Cloudflare R2 ストレージへのアップロード・管理サービス
 * S3互換APIを使用してR2にアクセスします。
 *
 * @see https://developers.cloudflare.com/r2/api/s3/api/
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

/**
 * R2 アップロード結果
 */
export interface R2UploadResult {
  /** R2 オブジェクトキー */
  key: string;
  /** 公開URL */
  url: string;
  /** ファイルサイズ（バイト） */
  size: number;
  /** Content-Type */
  contentType: string;
}

/**
 * R2 アップロードオプション
 */
export interface R2UploadOptions {
  /** オリジナルファイル名 */
  filename: string;
  /** Content-Type */
  contentType: string;
  /** フォルダパス（例: 'articles/2025/12'） */
  folder?: string;
  /** カスタムキー（指定しない場合はUUID生成） */
  customKey?: string;
  /** Cache-Control ヘッダー */
  cacheControl?: string;
  /** メタデータ */
  metadata?: Record<string, string>;
}

/**
 * Cloudflare R2 ストレージサービス
 *
 * S3互換APIを使用してR2にアクセスします。
 *
 * @see https://developers.cloudflare.com/r2/api/s3/api/
 */
export class R2StorageService {
  private client: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor() {
    // 環境変数の検証
    this.validateEnvironment();

    // S3互換クライアントの初期化
    this.client = new S3Client({
      region: 'auto', // R2は'auto'を使用
      endpoint: process.env.R2_ENDPOINT_URL!, // 管轄区域固有のエンドポイント
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    this.bucketName = process.env.R2_BUCKET_NAME!;
    this.publicUrl = process.env.R2_PUBLIC_URL!;
  }

  /**
   * 環境変数の検証
   */
  private validateEnvironment(): void {
    const required = [
      'R2_ENDPOINT_URL',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
      'R2_PUBLIC_URL',
    ];

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required R2 environment variables: ${missing.join(', ')}`
      );
    }
  }

  /**
   * 画像をR2にアップロード
   *
   * @param buffer 画像データ
   * @param options アップロードオプション
   * @returns アップロード結果
   */
  async uploadImage(
    buffer: Buffer,
    options: R2UploadOptions
  ): Promise<R2UploadResult> {
    const {
      filename,
      contentType,
      folder = 'images',
      customKey,
      cacheControl,
      metadata,
    } = options;

    // ファイルキーの生成
    const ext = this.getExtension(filename, contentType);
    const key = customKey || this.generateKey(folder, ext);

    console.log(`📤 Uploading image to R2: ${key}`);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: cacheControl || 'public, max-age=31536000, immutable', // 1年キャッシュ
          Metadata: metadata,
        })
      );

      const url = `${this.publicUrl}/${key}`;

      console.log(`✅ Upload successful: ${url}`);

      return {
        key,
        url,
        size: buffer.length,
        contentType,
      };
    } catch (error) {
      console.error(`❌ Failed to upload to R2: ${key}`, error);
      throw new Error(
        `R2 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 複数画像を一括アップロード
   *
   * @param images アップロードする画像配列
   * @param folder 保存先フォルダ
   * @returns アップロード結果の配列
   */
  async uploadMultipleImages(
    images: Array<{
      buffer: Buffer;
      filename: string;
      contentType: string;
    }>,
    folder?: string
  ): Promise<R2UploadResult[]> {
    console.log(`📤 Uploading ${images.length} images to R2...`);

    const results = await Promise.all(
      images.map((img) =>
        this.uploadImage(img.buffer, {
          filename: img.filename,
          contentType: img.contentType,
          folder,
        })
      )
    );

    console.log(`✅ All ${results.length} images uploaded successfully`);
    return results;
  }

  /**
   * URLから画像を取得してR2にアップロード
   *
   * @param imageUrl 元画像のURL
   * @param folder 保存先フォルダ
   * @returns アップロード結果
   */
  async uploadFromUrl(
    imageUrl: string,
    folder?: string
  ): Promise<R2UploadResult> {
    console.log(`🔗 Fetching image from URL: ${imageUrl}`);

    try {
      // 画像を取得
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RevolutionBot/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());

      // ファイル名を生成
      const urlPath = new URL(imageUrl).pathname;
      const filename = urlPath.split('/').pop() || 'image';

      return this.uploadImage(buffer, {
        filename,
        contentType,
        folder,
        metadata: {
          'original-url': imageUrl,
          'uploaded-at': new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`❌ Failed to upload from URL: ${imageUrl}`, error);
      throw error;
    }
  }

  /**
   * 複数のURLから画像を取得してアップロード
   *
   * @param imageUrls 元画像のURL配列
   * @param folder 保存先フォルダ
   * @returns アップロード結果の配列（失敗した場合はnull）
   */
  async uploadMultipleFromUrls(
    imageUrls: string[],
    folder?: string
  ): Promise<(R2UploadResult | null)[]> {
    console.log(`🔗 Uploading ${imageUrls.length} images from URLs...`);

    const results = await Promise.all(
      imageUrls.map(async (url) => {
        try {
          return await this.uploadFromUrl(url, folder);
        } catch (error) {
          console.warn(`⚠️ Failed to upload: ${url}`, error);
          return null;
        }
      })
    );

    const successful = results.filter((r) => r !== null).length;
    console.log(`✅ Uploaded ${successful}/${imageUrls.length} images`);

    return results;
  }

  /**
   * オブジェクトを削除
   *
   * @param key オブジェクトキー
   */
  async deleteObject(key: string): Promise<void> {
    console.log(`🗑️ Deleting object: ${key}`);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
    );

    console.log(`✅ Deleted: ${key}`);
  }

  /**
   * オブジェクトの存在確認
   *
   * @param key オブジェクトキー
   * @returns 存在する場合true
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * フォルダ内のオブジェクト一覧を取得
   *
   * @param prefix フォルダパス
   * @param maxKeys 最大取得数
   * @returns オブジェクトキーの配列
   */
  async listObjects(prefix: string, maxKeys = 1000): Promise<string[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
      })
    );

    return (response.Contents || []).map((obj) => obj.Key!).filter(Boolean);
  }

  /**
   * ユニークなキーを生成
   *
   * @description
   * URL構造: {folder}/{uuid}.{ext}
   * folderには eventType/year/postId が含まれる想定
   * year/monthは追加しない（postIdがULIDなので時系列ソート可能）
   */
  private generateKey(folder: string, ext: string): string {
    const uuid = uuidv4();
    return `${folder}/${uuid}.${ext}`;
  }

  /**
   * ファイル拡張子を取得
   */
  private getExtension(filename: string, contentType: string): string {
    // ファイル名から拡張子を取得
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      return extMatch[1].toLowerCase();
    }

    // Content-Typeから推測
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'image/svg+xml': 'svg',
    };

    return mimeMap[contentType] || 'jpg';
  }

  /**
   * 公開URLを取得
   */
  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  /**
   * R2接続テスト
   * バケットへのアクセスを確認します
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔌 Testing R2 connection...');
      console.log(`  Endpoint: ${process.env.R2_ENDPOINT_URL}`);
      console.log(`  Bucket: ${this.bucketName}`);

      // バケット内のオブジェクトを1件だけ取得してみる
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          MaxKeys: 1,
        })
      );

      console.log('✅ R2 connection successful');
      return true;
    } catch (error) {
      console.error('❌ R2 connection failed:', error);
      return false;
    }
  }
}

/**
 * シングルトンインスタンス
 */
let r2StorageServiceInstance: R2StorageService | null = null;

export function getR2StorageService(): R2StorageService {
  if (!r2StorageServiceInstance) {
    r2StorageServiceInstance = new R2StorageService();
  }
  return r2StorageServiceInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
export function resetR2StorageService(): void {
  r2StorageServiceInstance = null;
}

export const r2StorageService = {
  get instance() {
    return getR2StorageService();
  },
};
