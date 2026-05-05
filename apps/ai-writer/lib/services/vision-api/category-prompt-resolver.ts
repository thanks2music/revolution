/**
 * Category Prompt Resolver
 *
 * @description
 * Resolves the YAML-defined prompt content for a given Vision API extraction
 * category (menu / goods / novelty). Pure function — no side effects, no I/O.
 *
 * Sourced from `1.5-vision-extraction.yaml` (v1.2 SoT) and validated upstream by
 * `YamlTemplateLoaderService.loadVisionApiTemplate()`.
 *
 * @package revolution
 * @module services/vision-api/category-prompt-resolver
 */
import type { VisionApiTemplate } from '@/lib/types/vision-api';

export type VisionExtractionCategory = 'menu' | 'goods' | 'novelty';

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
