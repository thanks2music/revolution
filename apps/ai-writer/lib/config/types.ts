/**
 * Configuration Types Module
 *
 * Purpose:
 *   - Define TypeScript interfaces for YAML configuration files
 *   - Ensure type safety across slug generation logic
 *   - Support MVP Phase 0.1 URL structure
 *
 * @module lib/config/types
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

/**
 * Title Romaji Mapping Configuration
 *
 * Maps Japanese anime/manga titles to romanized slugs
 * Source: /revolution-templates/ai-writer/config/title-romaji-mapping.yaml
 *
 * @example
 * ```yaml
 * titles:
 *   "作品名": work-slug
 *   "作品別カテゴリ": work-category-slug
 * ```
 */
export interface TitleRomajiMapping {
  titles: {
    [japaneseTitle: string]: string; // romaji slug
  };
}

/**
 * Brand Slugs Configuration
 *
 * Maps store/brand names to slugs for /store-collabo URLs
 * Source: /revolution-templates/ai-writer/config/brand-slugs.yaml
 *
 * @example
 * ```yaml
 * brand_slugs:
 *   アベイル: avail
 *   しまむら: shimamura
 * ```
 */
export interface BrandSlugsConfig {
  brand_slugs: {
    [brandName: string]: string; // brand slug
  };
}

/**
 * Event Type Slugs Configuration
 *
 * Maps event type names (with synonyms) to canonical slugs
 * Source: /revolution-templates/ai-writer/config/event-type-slugs.yaml
 *
 * @example
 * ```yaml
 * event_types:
 *   コラボカフェ: collabo-cafe
 *   カフェコラボ: collabo-cafe  # Synonym
 *   ポップアップストア: pop-up-store
 * ```
 */
export interface EventTypeSlugsConfig {
  event_types: {
    [eventTypeName: string]: string; // event type slug
  };
}

/**
 * Prefecture Configuration
 *
 * Maps prefecture names (with variants) to slugs
 * Source: /revolution-templates/ai-writer/config/jp-prefecture.yaml
 *
 * @example
 * ```yaml
 * prefectures:
 *   東京都: tokyo
 *   東京: tokyo
 *   都: tokyo  # Abbreviation
 * ```
 */
export interface PrefectureConfig {
  prefectures: {
    [prefectureName: string]: string; // prefecture slug
  };
  regions?: {
    [regionName: string]: {
      slug: string;
      prefectures: string[];
    };
  };
  major_cities?: {
    [cityName: string]: string; // city slug
  };
}

/**
 * Taxonomy Configuration
 *
 * Defines URL axes and category/tag generation rules
 * Source: /revolution-templates/ai-writer/config/taxonomy.yaml
 *
 * @see URL設計 v1.1 (/notes/01-project-docs/01-architecture/03-url-design-v1.1.md)
 *
 * @example
 * ```yaml
 * axes:
 *   titles:
 *     description: "作品別にイベントを分類する軸"
 *     phase: "mvp"
 *     slug_resolution:
 *       primary: "title-romaji-mapping.yaml"
 *       fallback: "ai_transliteration"
 * ```
 */
export interface TaxonomyConfig {
  version: string;
  description: string;

  /**
   * URL軸（Axes）定義
   * MVP: titles, eventType
   * Phase1: areas
   */
  axes: {
    titles: TaxonomyAxis;
    eventType: TaxonomyAxis;
    areas: TaxonomyAxis;
  };

  /**
   * カテゴリ生成ルール
   * MdxFrontmatter.categories[] の生成に使用
   */
  category_rules: {
    description: string;
    generation_order: CategoryGenerationRule[];
    constraints: {
      min_count: number;
      max_count: number;
      validation: string;
    };
  };

  /**
   * タグ生成ルール（将来拡張用）
   * MdxFrontmatter.tags[] の生成に使用
   */
  tag_rules: {
    description: string;
    enabled: boolean;
    auto_generation?: TagAutoGenerationRule[];
    constraints: {
      max_count: number;
      validation: string;
    };
  };

  /**
   * フロントマター出力スキーマ
   */
  frontmatter_schema: {
    description: string;
    axis_fields: Record<string, FrontmatterFieldSchema>;
    taxonomy_fields: Record<string, FrontmatterFieldSchema>;
  };

  /**
   * 関連設定ファイル一覧
   */
  related_configs: Array<{
    file: string;
    purpose: string;
  }>;
}

/**
 * Taxonomy Axis Definition
 */
export interface TaxonomyAxis {
  description: string;
  phase: 'mvp' | 'phase1' | 'phase2';
  url_patterns: string[];
  source_fields: {
    name: string;
    slug: string;
  };
  slug_resolution: {
    primary: string;
    fallback: 'ai_transliteration' | 'error';
  };
  notes?: string[];
}

/**
 * Category Generation Rule
 */
export interface CategoryGenerationRule {
  source: string;
  priority: number;
  required: boolean;
  description: string;
  example: string;
  max_items?: number;
  notes?: string[];
}

/**
 * Tag Auto Generation Rule (将来拡張用)
 */
export interface TagAutoGenerationRule {
  source: string;
  mapping?: Record<string, string>;
  description?: string;
  example?: string;
  condition?: string;
}

/**
 * Frontmatter Field Schema
 */
export interface FrontmatterFieldSchema {
  type: 'string' | 'array';
  required: boolean;
  description: string;
  example: string | string[];
  resolution?: string;
  min_items?: number;
  max_items?: number;
}

/**
 * Configuration file paths
 *
 * These paths point to the private repository containing YAML configs
 * Note: Absolute paths are used to access files outside the main repository
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// プロジェクトルートからの相対パスで設定ファイルを参照
// 同期スクリプトで revolution-templates から apps/ai-writer/templates/config にコピーされる
const CONFIG_DIR = resolve(__dirname, '../../templates/config');

export const CONFIG_PATHS = {
  TITLE_ROMAJI: resolve(CONFIG_DIR, 'title-romaji-mapping.yaml'),
  BRAND_SLUGS: resolve(CONFIG_DIR, 'brand-slugs.yaml'),
  EVENT_TYPE_SLUGS: resolve(CONFIG_DIR, 'event-type-slugs.yaml'),
  JP_PREFECTURE: resolve(CONFIG_DIR, 'jp-prefecture.yaml'),
  TAXONOMY: resolve(CONFIG_DIR, 'taxonomy.yaml'),
} as const;

/**
 * Configuration key type for type-safe config loading
 */
export type ConfigKey = keyof typeof CONFIG_PATHS;

/**
 * Mapping from config key to expected config type
 */
export interface ConfigTypeMap {
  TITLE_ROMAJI: TitleRomajiMapping;
  BRAND_SLUGS: BrandSlugsConfig;
  EVENT_TYPE_SLUGS: EventTypeSlugsConfig;
  JP_PREFECTURE: PrefectureConfig;
  TAXONOMY: TaxonomyConfig;
}
