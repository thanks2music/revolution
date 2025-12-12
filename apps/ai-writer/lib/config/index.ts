/**
 * Configuration Module Entry Point
 *
 * @module lib/config
 */

// Export types
export type {
  TitleRomajiMapping,
  BrandSlugsConfig,
  EventTypeSlugsConfig,
  PrefectureConfig,
  ConfigKey,
  ConfigTypeMap,
} from './types';

export { CONFIG_PATHS } from './types';

// Export YAML loader functions
export {
  loadYamlConfig,
  clearConfigCache,
  preloadAllConfigs,
} from './yaml-loader';

// Export slug resolver functions
export {
  resolveWorkSlug,
  resolveStoreSlug,
  resolveEventTypeSlug,
  resolvePrefectureSlug,
  resolveCitySlug,
  getAllWorkTitles,
  getAllBrandNames,
  getAllEventTypeNames,
  getAllPrefectureNames,
  isValidWorkTitle,
  isValidBrandName,
  isValidEventTypeName,
} from './slug-resolver';
