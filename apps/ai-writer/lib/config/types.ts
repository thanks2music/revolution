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
 *   "呪術廻戦": jujutsu-kaisen
 *   "SPY×FAMILY": spy-family
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
// 同期スクリプトで revolution-templates から apps/ai-writer/config にコピーされる
const CONFIG_DIR = resolve(__dirname, '../../config');

export const CONFIG_PATHS = {
  TITLE_ROMAJI: resolve(CONFIG_DIR, 'title-romaji-mapping.yaml'),
  BRAND_SLUGS: resolve(CONFIG_DIR, 'brand-slugs.yaml'),
  EVENT_TYPE_SLUGS: resolve(CONFIG_DIR, 'event-type-slugs.yaml'),
  JP_PREFECTURE: resolve(CONFIG_DIR, 'jp-prefecture.yaml'),
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
}
