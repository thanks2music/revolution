/**
 * YAML Configuration Loader Module
 *
 * Purpose:
 *   - Load and parse YAML configuration files from private repository
 *   - Provide caching to avoid repeated file I/O
 *   - Ensure type safety with TypeScript interfaces
 *
 * @module lib/config/yaml-loader
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import { readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import {
  CONFIG_PATHS,
  type ConfigKey,
  type ConfigTypeMap,
} from './types';

/**
 * In-memory cache for loaded YAML configurations
 * Prevents repeated file I/O operations
 */
const configCache: Partial<ConfigTypeMap> = {};

/**
 * Loads a YAML configuration file
 *
 * @description
 * Generic YAML loader with type safety and caching.
 * On first call, reads and parses the YAML file, then caches the result.
 * Subsequent calls return the cached value.
 *
 * @template K - Configuration key type
 * @param {K} configKey - The configuration key to load
 * @param {boolean} forceReload - Force reload from file, bypassing cache
 * @returns {ConfigTypeMap[K]} Parsed configuration object
 *
 * @example
 * ```typescript
 * const titleMapping = loadYamlConfig('TITLE_ROMAJI');
 * const brandSlugs = loadYamlConfig('BRAND_SLUGS');
 * ```
 *
 * @throws {Error} If file cannot be read or parsed
 */
export function loadYamlConfig<K extends ConfigKey>(
  configKey: K,
  forceReload = false
): ConfigTypeMap[K] {
  // Return cached value if available and not forcing reload
  if (!forceReload && configCache[configKey]) {
    return configCache[configKey] as ConfigTypeMap[K];
  }

  const filePath = CONFIG_PATHS[configKey];

  try {
    // Read YAML file
    const fileContents = readFileSync(filePath, 'utf8');

    // Parse YAML
    const parsedConfig = yamlLoad(fileContents) as ConfigTypeMap[K];

    // Validate that parsing returned an object
    if (!parsedConfig || typeof parsedConfig !== 'object') {
      throw new Error(`Invalid YAML structure in ${filePath}`);
    }

    // Cache the result
    configCache[configKey] = parsedConfig;

    return parsedConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load YAML config from ${filePath}: ${error.message}`
      );
    }
    throw new Error(`Failed to load YAML config from ${filePath}: Unknown error`);
  }
}

/**
 * Clears the configuration cache
 *
 * @description
 * Useful for testing or when config files are updated
 *
 * @param {ConfigKey} configKey - Specific config to clear, or clear all if omitted
 *
 * @example
 * ```typescript
 * clearConfigCache('TITLE_ROMAJI'); // Clear specific config
 * clearConfigCache(); // Clear all configs
 * ```
 */
export function clearConfigCache(configKey?: ConfigKey): void {
  if (configKey) {
    delete configCache[configKey];
  } else {
    // Clear all
    (Object.keys(configCache) as ConfigKey[]).forEach((key) => {
      delete configCache[key];
    });
  }
}

/**
 * Preloads all configuration files into cache
 *
 * @description
 * Useful for warming up the cache on application startup
 *
 * @example
 * ```typescript
 * await preloadAllConfigs();
 * // All configs are now cached
 * ```
 */
export function preloadAllConfigs(): void {
  const configKeys: ConfigKey[] = [
    'TITLE_ROMAJI',
    'BRAND_SLUGS',
    'EVENT_TYPE_SLUGS',
    'JP_PREFECTURE',
    'TAXONOMY',
  ];

  configKeys.forEach((key) => {
    try {
      loadYamlConfig(key);
    } catch (error) {
      console.warn(`Failed to preload config ${key}:`, error);
    }
  });
}
