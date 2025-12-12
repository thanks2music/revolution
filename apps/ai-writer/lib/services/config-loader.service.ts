/**
 * Config Loader Service
 * config/ ディレクトリのYAML設定ファイルを読み込むサービス
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type {
  StoreUrlPatternsConfig,
  BrandSlugsConfig,
} from '@/lib/types/subpage-detection';

/**
 * Config Loader Service
 */
export class ConfigLoaderService {
  private readonly configDir: string;

  // キャッシュ
  private storeUrlPatternsCache: StoreUrlPatternsConfig | null = null;
  private brandSlugsCache: BrandSlugsConfig | null = null;

  constructor(configDir?: string) {
    // デフォルトは apps/ai-writer/templates/config
    this.configDir = configDir || path.join(process.cwd(), 'templates', 'config');
  }

  /**
   * store-url-patterns.yaml を読み込む
   */
  async loadStoreUrlPatterns(): Promise<StoreUrlPatternsConfig> {
    if (this.storeUrlPatternsCache) {
      return this.storeUrlPatternsCache;
    }

    const filePath = path.join(this.configDir, 'store-url-patterns.yaml');
    const content = await this.loadYamlFile<StoreUrlPatternsConfig>(filePath);

    // 必須フィールドの検証
    if (!content.stores) {
      throw new Error('Invalid store-url-patterns.yaml: missing stores');
    }
    if (!content.default_patterns) {
      throw new Error('Invalid store-url-patterns.yaml: missing default_patterns');
    }

    this.storeUrlPatternsCache = content;
    console.log('[ConfigLoader] Loaded store-url-patterns.yaml');
    return content;
  }

  /**
   * brand-slugs.yaml を読み込む
   */
  async loadBrandSlugs(): Promise<BrandSlugsConfig> {
    if (this.brandSlugsCache) {
      return this.brandSlugsCache;
    }

    const filePath = path.join(this.configDir, 'brand-slugs.yaml');
    const content = await this.loadYamlFile<BrandSlugsConfig>(filePath);

    // 必須フィールドの検証
    if (!content.brand_slugs) {
      throw new Error('Invalid brand-slugs.yaml: missing brand_slugs');
    }

    this.brandSlugsCache = content;
    console.log('[ConfigLoader] Loaded brand-slugs.yaml');
    return content;
  }

  /**
   * 店舗名からスラッグを解決
   * @param storeName 店舗名（例: "BOX cafe&space"）
   * @returns スラッグ（例: "box-cafe-and-space"）、見つからない場合はnull
   */
  async resolveStoreSlug(storeName: string): Promise<string | null> {
    const brandSlugs = await this.loadBrandSlugs();

    // 完全一致
    if (brandSlugs.brand_slugs[storeName]) {
      return brandSlugs.brand_slugs[storeName];
    }

    // 大文字小文字を無視して検索
    const lowerStoreName = storeName.toLowerCase();
    for (const [name, slug] of Object.entries(brandSlugs.brand_slugs)) {
      if (name.toLowerCase() === lowerStoreName) {
        return slug;
      }
    }

    // 部分一致（店舗名に含まれるキーを探す）
    for (const [name, slug] of Object.entries(brandSlugs.brand_slugs)) {
      if (
        storeName.includes(name) ||
        name.includes(storeName) ||
        lowerStoreName.includes(name.toLowerCase()) ||
        name.toLowerCase().includes(lowerStoreName)
      ) {
        return slug;
      }
    }

    return null;
  }

  /**
   * YAMLファイルを読み込んでパース
   */
  private async loadYamlFile<T>(filePath: string): Promise<T> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return yaml.load(content) as T;
    } catch (error) {
      console.error(`[ConfigLoader] Failed to load ${filePath}:`, error);
      throw new Error(
        `Failed to load config file "${filePath}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * キャッシュをクリア（テスト用）
   */
  clearCache(): void {
    this.storeUrlPatternsCache = null;
    this.brandSlugsCache = null;
  }
}

/**
 * シングルトンインスタンス
 */
let _configLoaderService: ConfigLoaderService | null = null;

export function getConfigLoaderService(): ConfigLoaderService {
  if (!_configLoaderService) {
    _configLoaderService = new ConfigLoaderService();
  }
  return _configLoaderService;
}
