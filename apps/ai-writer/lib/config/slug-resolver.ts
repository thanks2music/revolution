/**
 * Slug Resolver Module
 *
 * Purpose:
 *   - Provide domain-specific slug resolution functions
 *   - Abstract YAML config access with clean API
 *   - Support MVP Phase 0.1 canonicalKey generation
 *
 * @module lib/config/slug-resolver
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import { loadYamlConfig } from './yaml-loader';

/**
 * Resolves a Japanese anime/manga title to its romaji slug
 *
 * @description
 * Looks up the title in title-romaji-mapping.yaml
 * Used for URL construction: /collabo-cafe/{work-slug}/...
 *
 * @param {string} japaneseTitle - Japanese title (e.g., "呪術廻戦")
 * @returns {string | null} Romaji slug (e.g., "jujutsu-kaisen") or null if not found
 *
 * @example
 * ```typescript
 * const slug = resolveWorkSlug("呪術廻戦");
 * console.log(slug); // "jujutsu-kaisen"
 *
 * const unknown = resolveWorkSlug("Unknown Title");
 * console.log(unknown); // null
 * ```
 */
export function resolveWorkSlug(japaneseTitle: string): string | null {
  const config = loadYamlConfig('TITLE_ROMAJI');
  return config.titles[japaneseTitle] || null;
}

/**
 * Resolves a brand/store name to its slug
 *
 * @description
 * Looks up the brand in brand-slugs.yaml
 * Used for canonicalKey: {workSlug}:{storeSlug}:{eventType}:{year}
 *
 * @param {string} brandName - Brand name (e.g., "アベイル", "しまむら")
 * @returns {string | null} Brand slug (e.g., "avail", "shimamura") or null if not found
 *
 * @example
 * ```typescript
 * const slug = resolveStoreSlug("アベイル");
 * console.log(slug); // "avail"
 *
 * const unknown = resolveStoreSlug("Unknown Store");
 * console.log(unknown); // null
 * ```
 */
export function resolveStoreSlug(brandName: string): string | null {
  const config = loadYamlConfig('BRAND_SLUGS');
  return config.brand_slugs[brandName] || null;
}

/**
 * Resolves an event type name to its canonical slug
 *
 * @description
 * Looks up the event type in event-type-slugs.yaml
 * Handles synonyms (e.g., "コラボカフェ" and "カフェコラボ" both map to "collabo-cafe")
 *
 * @param {string} eventTypeName - Event type name (e.g., "コラボカフェ", "ポップアップストア")
 * @returns {string | null} Event type slug (e.g., "collabo-cafe", "pop-up-store") or null if not found
 *
 * @example
 * ```typescript
 * const slug1 = resolveEventTypeSlug("コラボカフェ");
 * const slug2 = resolveEventTypeSlug("カフェコラボ");
 * console.log(slug1 === slug2); // true (both return "collabo-cafe")
 * ```
 */
export function resolveEventTypeSlug(eventTypeName: string): string | null {
  const config = loadYamlConfig('EVENT_TYPE_SLUGS');
  return config.event_types[eventTypeName] || null;
}

/**
 * Resolves a prefecture name to its slug
 *
 * @description
 * Looks up the prefecture in jp-prefecture.yaml
 * Handles variants (e.g., "東京都", "東京", "都" all map to "tokyo")
 * Note: Phase 0.1 does not use prefecture slugs, but this is prepared for Phase 1+
 *
 * @param {string} prefectureName - Prefecture name (e.g., "東京都", "大阪府")
 * @returns {string | null} Prefecture slug (e.g., "tokyo", "osaka") or null if not found
 *
 * @example
 * ```typescript
 * const slug1 = resolvePrefectureSlug("東京都");
 * const slug2 = resolvePrefectureSlug("東京");
 * const slug3 = resolvePrefectureSlug("都");
 * console.log(slug1 === slug2 && slug2 === slug3); // true (all return "tokyo")
 * ```
 */
export function resolvePrefectureSlug(prefectureName: string): string | null {
  const config = loadYamlConfig('JP_PREFECTURE');
  return config.prefectures[prefectureName] || null;
}

/**
 * Resolves a city name to its slug
 *
 * @description
 * Looks up the city in jp-prefecture.yaml major_cities section
 * Note: Phase 0.1 does not use city slugs, prepared for future use
 *
 * @param {string} cityName - City name (e.g., "新宿", "渋谷")
 * @returns {string | null} City slug (e.g., "shinjuku", "shibuya") or null if not found
 *
 * @example
 * ```typescript
 * const slug = resolveCitySlug("新宿");
 * console.log(slug); // "shinjuku"
 * ```
 */
export function resolveCitySlug(cityName: string): string | null {
  const config = loadYamlConfig('JP_PREFECTURE');
  return config.major_cities?.[cityName] || null;
}

/**
 * Gets all available work titles
 *
 * @description
 * Returns all Japanese titles from the config
 * Useful for validation or autocomplete features
 *
 * @returns {string[]} Array of Japanese titles
 *
 * @example
 * ```typescript
 * const titles = getAllWorkTitles();
 * console.log(titles); // ["呪術廻戦", "SPY×FAMILY", ...]
 * ```
 */
export function getAllWorkTitles(): string[] {
  const config = loadYamlConfig('TITLE_ROMAJI');
  return Object.keys(config.titles);
}

/**
 * Gets all available brand names
 *
 * @description
 * Returns all brand names from the config
 *
 * @returns {string[]} Array of brand names
 *
 * @example
 * ```typescript
 * const brands = getAllBrandNames();
 * console.log(brands); // ["アベイル", "しまむら", ...]
 * ```
 */
export function getAllBrandNames(): string[] {
  const config = loadYamlConfig('BRAND_SLUGS');
  return Object.keys(config.brand_slugs);
}

/**
 * Gets all available event type names
 *
 * @description
 * Returns all event type names (including synonyms) from the config
 *
 * @returns {string[]} Array of event type names
 *
 * @example
 * ```typescript
 * const types = getAllEventTypeNames();
 * console.log(types); // ["コラボカフェ", "カフェコラボ", "ポップアップストア", ...]
 * ```
 */
export function getAllEventTypeNames(): string[] {
  const config = loadYamlConfig('EVENT_TYPE_SLUGS');
  return Object.keys(config.event_types);
}

/**
 * Gets all available prefecture names
 *
 * @description
 * Returns all prefecture names (including variants) from the config
 *
 * @returns {string[]} Array of prefecture names
 *
 * @example
 * ```typescript
 * const prefectures = getAllPrefectureNames();
 * console.log(prefectures); // ["東京都", "東京", "都", "大阪府", ...]
 * ```
 */
export function getAllPrefectureNames(): string[] {
  const config = loadYamlConfig('JP_PREFECTURE');
  return Object.keys(config.prefectures);
}

/**
 * Validates if a work title exists in the config
 *
 * @param {string} japaneseTitle - Japanese title to validate
 * @returns {boolean} True if title exists in config
 *
 * @example
 * ```typescript
 * console.log(isValidWorkTitle("呪術廻戦")); // true
 * console.log(isValidWorkTitle("Unknown")); // false
 * ```
 */
export function isValidWorkTitle(japaneseTitle: string): boolean {
  return resolveWorkSlug(japaneseTitle) !== null;
}

/**
 * Validates if a brand name exists in the config
 *
 * @param {string} brandName - Brand name to validate
 * @returns {boolean} True if brand exists in config
 *
 * @example
 * ```typescript
 * console.log(isValidBrandName("アベイル")); // true
 * console.log(isValidBrandName("Unknown")); // false
 * ```
 */
export function isValidBrandName(brandName: string): boolean {
  return resolveStoreSlug(brandName) !== null;
}

/**
 * Validates if an event type name exists in the config
 *
 * @param {string} eventTypeName - Event type name to validate
 * @returns {boolean} True if event type exists in config
 *
 * @example
 * ```typescript
 * console.log(isValidEventTypeName("コラボカフェ")); // true
 * console.log(isValidEventTypeName("Unknown")); // false
 * ```
 */
export function isValidEventTypeName(eventTypeName: string): boolean {
  return resolveEventTypeSlug(eventTypeName) !== null;
}
