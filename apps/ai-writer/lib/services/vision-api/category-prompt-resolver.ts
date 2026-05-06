/**
 * Resolves the YAML prompt for a Vision API extraction category. Pure.
 * Backed by `1.5-vision-extraction.yaml` (v1.2 SoT) and validated upstream
 * by `YamlTemplateLoaderService.loadVisionApiTemplate()`.
 */
import type { VisionApiTemplate, VisionExtractionCategory } from '@/lib/types/vision-api';

export type { VisionExtractionCategory };

/**
 * Canonical iteration order for the three Vision extraction categories.
 * Re-exported here (rather than redefined in each consumer) so that adding a
 * fourth category is a single-edit change in this module.
 */
export const VISION_CATEGORIES = ['menu', 'goods', 'novelty'] as const satisfies readonly VisionExtractionCategory[];

const CATEGORY_TO_PROMPT_KEY = {
  menu: 'menu_extraction',
  goods: 'goods_extraction',
  novelty: 'novelty_extraction',
} as const satisfies Record<VisionExtractionCategory, keyof VisionApiTemplate['prompts']>;

/**
 * Thrown when the requested category does not have a corresponding prompt
 * in the supplied template (e.g. caller passed an unknown string at runtime,
 * or the YAML template was loaded with missing fields despite loader checks).
 */
export class UnknownVisionCategoryError extends Error {
  constructor(public readonly category: string) {
    super(`Unknown or missing vision extraction prompt for category: "${category}"`);
    this.name = 'UnknownVisionCategoryError';
  }
}

/**
 * Returns the prompt string to send to the Vision API for the given category.
 *
 * @throws {UnknownVisionCategoryError} if the template is missing the prompt
 *   entry for the requested category (defensive — `loadVisionApiTemplate`
 *   already enforces presence at load time).
 */
export function resolveVisionPrompt(
  template: VisionApiTemplate,
  category: VisionExtractionCategory,
): string {
  // Defensive guard: `key` is statically derived for any value of the
  // `VisionExtractionCategory` union, so this branch is unreachable at the
  // TypeScript level. It catches runtime type-erasure cases (e.g. a caller
  // that bypassed the type with `as VisionExtractionCategory`) and surfaces
  // them as a structured error rather than `undefined.content` later.
  const key = CATEGORY_TO_PROMPT_KEY[category];
  if (!key) {
    throw new UnknownVisionCategoryError(category);
  }
  const prompt = template.prompts?.[key];
  if (!prompt || typeof prompt.content !== 'string' || prompt.content.length === 0) {
    throw new UnknownVisionCategoryError(category);
  }
  return prompt.content;
}
