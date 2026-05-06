/**
 * Multi-category Vision API orchestrator.
 *
 * Calls one `IVisionApiService` per category (menu / goods / novelty) in
 * parallel via `Promise.allSettled` and merges the successes via
 * `mergeVisionResults`. Per-category errors do NOT short-circuit other
 * categories. Categories with no images are skipped (no API call) and
 * reported in `perCategory[cat].skipped`.
 */
import type {
  IVisionApiService,
  VisionApiTemplate,
  VisionExtractionCategory,
  VisionExtractionResult,
} from '@/lib/types/vision-api';
import { resolveVisionPrompt } from './category-prompt-resolver';
import { mergeVisionResults, type CategoryResults } from './merge-vision-results';

/**
 * Per-category image map. Designed as a structural subset of both
 * `content-generation.service.ts:CategoryImages` and
 * `category-image-extractor.service.ts:CategoryImages` so the orchestrator
 * accepts either without coupling to a specific producer.
 */
export interface MultiCategoryImageMap {
  menu: string[];
  goods: string[];
  novelty: string[];
}

export interface PerCategoryStatus {
  ok: boolean;
  /** Set when `ok === false`. Human-readable error message. */
  error?: string;
  /** Set when the category was intentionally skipped (e.g. no images). */
  skipped?: string;
}

export interface MultiCategoryVisionResult {
  result: VisionExtractionResult;
  perCategory: Record<VisionExtractionCategory, PerCategoryStatus>;
}

export interface MultiCategoryVisionOptions {
  /** Forwarded to `IVisionApiService.extractFromImages.maxRetries`. */
  maxRetries?: number;
  /** Forwarded to `IVisionApiService.extractFromImages.timeout` (ms). */
  timeout?: number;
}

const CATEGORIES = ['menu', 'goods', 'novelty'] as const satisfies readonly VisionExtractionCategory[];

/**
 * Run the Vision API once per category in parallel and merge the results.
 *
 * Categories with `images[cat].length === 0` are skipped without an API call.
 *
 * @param service Vision API service (concrete provider already chosen)
 * @param template YAML-loaded `VisionApiTemplate` (v1.2)
 * @param images per-category image URL arrays
 * @param options retry / timeout overrides forwarded to the service
 */
export async function callVisionApiForAllCategories(
  service: IVisionApiService,
  template: VisionApiTemplate,
  images: MultiCategoryImageMap,
  options: MultiCategoryVisionOptions = {},
): Promise<MultiCategoryVisionResult> {
  const settled = await Promise.allSettled(
    CATEGORIES.map((category) =>
      callOneCategory(service, template, category, images[category], options),
    ),
  );

  const perCategory: Record<VisionExtractionCategory, PerCategoryStatus> = {
    menu: { ok: false },
    goods: { ok: false },
    novelty: { ok: false },
  };
  const successful: CategoryResults = {};

  settled.forEach((entry, idx) => {
    const category = CATEGORIES[idx];
    if (entry.status === 'fulfilled') {
      const { result, skipped } = entry.value;
      perCategory[category] = skipped ? { ok: true, skipped } : { ok: true };
      if (result) {
        successful[category] = result;
      }
    } else {
      perCategory[category] = {
        ok: false,
        error:
          entry.reason instanceof Error
            ? entry.reason.message
            : String(entry.reason),
      };
    }
  });

  const result = mergeVisionResults(successful);
  return { result, perCategory };
}

async function callOneCategory(
  service: IVisionApiService,
  template: VisionApiTemplate,
  category: VisionExtractionCategory,
  imageUrls: string[],
  options: MultiCategoryVisionOptions,
): Promise<{ result?: VisionExtractionResult; skipped?: string }> {
  if (imageUrls.length === 0) {
    return { skipped: 'no images' };
  }
  const prompt = resolveVisionPrompt(template, category);
  const result = await service.extractFromImages({
    imageUrls,
    prompt,
    category,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
  });
  return { result };
}
