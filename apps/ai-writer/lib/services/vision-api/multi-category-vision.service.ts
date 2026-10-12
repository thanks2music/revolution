/**
 * Multi-category Vision API orchestrator.
 *
 * Calls one `IVisionApiService` per category (menu / goods / novelty) in
 * parallel via `Promise.allSettled` and merges the successes via
 * `mergeVisionResults`. Per-category errors do NOT short-circuit other
 * categories. Categories with no images, or outside `options.categories`,
 * are skipped (no API call) and reported in `perCategory[cat].skipped`.
 *
 * 「Coming Soon」の画像から品目を作ったカテゴリは、そのカテゴリの結果だけを捨てる
 * (`perCategory[cat].discarded`)。他のカテゴリの正しい品目は残す。
 */
import type {
  IVisionApiService,
  VisionApiTemplate,
  VisionExtractionCategory,
  VisionExtractionResult,
  VisionImage,
} from '@/lib/types/vision-api';
import { resolveVisionPrompt, VISION_CATEGORIES } from './category-prompt-resolver';
import { mergeVisionResults, type CategoryResults } from './merge-vision-results';
import { detectHallucination } from '@/lib/utils/vision-api-utils';
import { prepareVisionImages } from './prepare-vision-images';

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
  /** 呼んだが結果を捨てたとき (Coming Soon の画像から品目を作った) の理由 */
  discarded?: string;
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
  /** 読むカテゴリ (既定は 3 つとも)。HTML から書けなかった項目のカテゴリだけを渡す */
  categories?: readonly VisionExtractionCategory[];
  /** 画像の取得・分割 (既定は `prepareVisionImages`。テストで差し替える) */
  prepareImages?: (imageUrls: string[]) => Promise<VisionImage[]>;
}

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
    VISION_CATEGORIES.map((category) =>
      options.categories && !options.categories.includes(category)
        ? Promise.resolve<CategoryCallResult>({ skipped: 'not needed' })
        : callOneCategory(service, template, category, images[category], options),
    ),
  );

  const perCategory: Record<VisionExtractionCategory, PerCategoryStatus> = {
    menu: { ok: false },
    goods: { ok: false },
    novelty: { ok: false },
  };
  const successful: CategoryResults = {};

  settled.forEach((entry, idx) => {
    const category = VISION_CATEGORIES[idx];
    if (entry.status === 'fulfilled') {
      const { result, skipped } = entry.value;
      perCategory[category] = skipped ? { ok: true, skipped } : { ok: true };
      if (result) {
        const hallucination = detectHallucination(result);
        if (hallucination.detected) {
          perCategory[category] = { ok: true, discarded: hallucination.reason };
        } else {
          successful[category] = result;
        }
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

  const result = mergeVisionResults(successful, service.getProviderName());
  return { result, perCategory };
}

interface CategoryCallResult {
  result?: VisionExtractionResult;
  skipped?: string;
}

async function callOneCategory(
  service: IVisionApiService,
  template: VisionApiTemplate,
  category: VisionExtractionCategory,
  imageUrls: string[],
  options: MultiCategoryVisionOptions,
): Promise<CategoryCallResult> {
  if (imageUrls.length === 0) {
    return { skipped: 'no images' };
  }
  const images = await (options.prepareImages ?? prepareVisionImages)(imageUrls);
  if (images.length === 0) {
    return { skipped: 'images could not be fetched' };
  }
  const prompt = resolveVisionPrompt(template, category);
  const result = await service.extractFromImages({
    images,
    prompt,
    category,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
  });
  return { result };
}
