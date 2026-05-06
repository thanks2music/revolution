/**
 * Vision API E2E Test - Princess Cafe (Tokyo Revengers)
 *
 * @description
 * End-to-end test for Vision API integration pipeline (Templates v1.2 multi-category).
 *
 * Main scenarios: provider × category two-level describe.each (2 × 3 = 6 cases).
 * Each category uses its dedicated `tr2604_sb_*.webp` fixture.
 *
 * Error scenarios (timeout / invalid URL / missing API key): provider one-level
 * describe.each (3 × 2 = 6 cases). Uses existing `toreve2512_food.webp`
 * (historical fixture, category-agnostic).
 *
 * @package revolution
 * @module __tests__/e2e/vision-api-pipeline
 * @jest-environment node
 */

// Unmock Anthropic SDK for E2E testing (jest.setup.mjs globally mocks it).
// We need real API calls for E2E tests, not mocked responses.
jest.unmock('@anthropic-ai/sdk');

import { VisionApiServiceFactory } from '@/lib/services/vision-api/vision-api-service.factory';
import type { IVisionApiService, VisionProvider } from '@/lib/types/vision-api';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import {
  crossCheckVisionResult,
  detectHallucination,
  selectFallbackLevel,
  validateBusinessRules,
} from '@/lib/utils/vision-api-utils';
import type { HtmlExtractionData } from '@/lib/utils/vision-api-utils';
import { checkExtractionSufficiency } from '@/lib/config/vision-api-thresholds';

/**
 * Providers under test
 */
const PROVIDERS_TO_TEST: VisionProvider[] = ['openai', 'claude'];

/**
 * Categories under test (Templates v1.2 contract: menu / goods / novelty).
 */
const CATEGORIES_TO_TEST = ['menu', 'goods', 'novelty'] as const;
type Category = (typeof CATEGORIES_TO_TEST)[number];

/**
 * Per-provider API key requirement
 * E2E tests hit real APIs and require the corresponding key to be set.
 * Without keys (e.g. CI without secrets), the provider's tests are skipped.
 */
const PROVIDER_API_KEY_ENV: Record<VisionProvider, string> = {
  openai: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
};

/**
 * Main-scenario fixtures: Princess Cafe × Tokyo Revengers (tr2604_sb_*.webp)
 * — category-specific images. Note: the menu image (tr2604_sb_food.webp) carries
 * a novelty information strip at its bottom edge, so menu_extraction can surface
 * `menuItems[].hasNovelty` / `noveltyCondition` even though novelty has its own
 * dedicated fixture.
 */
const TR2604_FIXTURES: Record<Category, string[]> = {
  menu: ['https://www.pripricafe.com/event/cafe/img/tr2604_sb_food.webp'],
  goods: ['https://www.pripricafe.com/event/cafe/img/tr2604_sb_goods.webp'],
  novelty: ['https://www.pripricafe.com/event/cafe/img/tr2604_sb_camp.webp?0'],
};

/**
 * Error-scenario fixture: historical Tokyo Revengers menu image used in
 * pre-Templates-v1.2 tests. Category-agnostic for error path coverage.
 */
const TOREVE_2512_MENU = 'https://www.pripricafe.com/event/cafe/img/toreve2512_food.webp';

describe.each(PROVIDERS_TO_TEST)(
  'Vision API E2E - Provider: %s',
  (provider: VisionProvider) => {
    const apiKeyEnv = PROVIDER_API_KEY_ENV[provider];
    const hasApiKey = Boolean(process.env[apiKeyEnv]);

    if (!hasApiKey) {
      it.skip(`(skipped: ${apiKeyEnv} not set, real API call required)`, () => {});
      return;
    }

    let visionApiService: IVisionApiService;
    let yamlTemplateLoaderService: YamlTemplateLoaderService;

    beforeAll(() => {
      visionApiService = VisionApiServiceFactory.create(provider);
      yamlTemplateLoaderService = new YamlTemplateLoaderService();
      console.log(`[E2E Test] Initialized Vision API service with provider: ${provider}`);
    });

    /**
     * Main scenarios — provider × category (3 categories × 2 providers = 6 cases).
     * Each category uses its dedicated tr2604_sb_*.webp fixture.
     */
    describe.each(CATEGORIES_TO_TEST)('main category: %s', (category: Category) => {
      it(`extracts ${category} items from category-specific image (${provider})`, async () => {
        const fixtureUrls = TR2604_FIXTURES[category];

        // Step 1: HTML extraction (insufficient — drives Vision API path)
        const htmlExtraction: HtmlExtractionData = {
          menuItemCount: 0,
          priceCount: 0,
          htmlSufficiencyRate: 0.05,
        };

        // Step 2: Sufficiency check
        const sufficiencyResult = checkExtractionSufficiency(
          htmlExtraction.menuItemCount,
          htmlExtraction.priceCount,
          htmlExtraction.htmlSufficiencyRate,
        );
        expect(sufficiencyResult.isSufficient).toBe(false);

        // Step 3: Load Templates v1.2 prompt for this category
        const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');
        const promptKey = `${category}_extraction` as const;
        const prompt = template.prompts[promptKey].content;

        console.log(
          `[E2E Test] (${provider}/${category}) calling Vision API with fixture:`,
          fixtureUrls,
        );

        // Step 4: Call Vision API
        const visionResult = await visionApiService.extractFromImages({
          imageUrls: fixtureUrls,
          prompt,
          category,
          maxRetries: 3,
          timeout: 60000,
        });

        expect(visionResult).toBeDefined();
        expect(visionResult.visionExtraction).toBeDefined();
        expect(visionResult.visionExtraction.provider).toBe(provider);
        expect(visionResult.visionExtraction.confidence).toBeGreaterThanOrEqual(0);
        expect(visionResult.visionExtraction.confidence).toBeLessThanOrEqual(1);

        // Step 5: Each scenario expects ≥ 1 item in its own category.
        const items =
          category === 'menu'
            ? visionResult.visionExtraction.menuItems
            : category === 'goods'
              ? visionResult.visionExtraction.goodsItems
              : visionResult.visionExtraction.noveltyItems;

        expect(items.length).toBeGreaterThanOrEqual(1);
        expect(visionResult.visionExtraction.confidence).toBeGreaterThanOrEqual(0.3);

        // characterName must be an array (Templates v1.1+ contract).
        for (const item of items) {
          expect(Array.isArray(item.characterName)).toBe(true);
        }

        // Step 6: Cross-check (HTML vs Vision API)
        const crossCheck = crossCheckVisionResult(visionResult, htmlExtraction);
        expect(crossCheck.details).toBeDefined();

        // Step 7: Hallucination detection
        const hallucination = detectHallucination(visionResult, htmlExtraction);
        expect(hallucination.detected).toBe(false);

        // Step 8: Fallback level selection
        const fallbackLevel = selectFallbackLevel(visionResult);
        expect(['A', 'B', 'C']).toContain(fallbackLevel);

        // Step 9: Business rules validation
        const businessValidation = validateBusinessRules(visionResult);
        expect(businessValidation.adjustedConfidence).toBeGreaterThanOrEqual(0);

        console.log(
          `[E2E Test] (${provider}/${category}) extracted ${items.length} item(s), confidence=${visionResult.visionExtraction.confidence.toFixed(2)}, fallback=${fallbackLevel}`,
        );
      }, 120000); // 120 second timeout for API calls (3 retries × ~30s each)
    });

    /**
     * Error scenarios — provider 1-level (3 scenarios × 2 providers = 6 cases).
     * Uses historical toreve2512_food.webp fixture (category-agnostic).
     */

    it(`should handle Vision API timeout gracefully (${provider})`, async () => {
      const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

      await expect(
        visionApiService.extractFromImages({
          imageUrls: [TOREVE_2512_MENU],
          prompt: template.prompts.menu_extraction.content,
          category: 'menu',
          maxRetries: 1,
          timeout: 1, // 1 ms - guaranteed timeout
        }),
      ).rejects.toThrow(
        provider === 'openai'
          ? /Vision API timeout/
          : /Vision API timeout|Claude Vision API timeout/,
      );
    });

    it(`should handle invalid image URL gracefully (${provider})`, async () => {
      const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

      const result = await visionApiService.extractFromImages({
        imageUrls: ['https://invalid-url-that-does-not-exist.com/image.jpg'],
        prompt: template.prompts.menu_extraction.content,
        category: 'menu',
        maxRetries: 2,
        timeout: 10000,
      });

      // Both providers should return empty results for invalid URLs.
      expect(result.visionExtraction.menuItems).toHaveLength(0);
      expect(result.visionExtraction.goodsItems).toHaveLength(0);
      expect(result.visionExtraction.noveltyItems).toHaveLength(0);
      expect(result.visionExtraction.confidence).toBeGreaterThanOrEqual(0);
      expect(result.visionExtraction.confidence).toBeLessThanOrEqual(1);
    });

    it(`should throw error if API key is missing (${provider})`, () => {
      const apiKeyEnvVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
      const originalKey = process.env[apiKeyEnvVar];
      delete process.env[apiKeyEnvVar];

      expect(() => {
        VisionApiServiceFactory.create(provider);
      }).toThrow(
        provider === 'openai'
          ? /OpenAI API key is required/
          : /Claude API key is required/,
      );

      // Restore
      if (originalKey) {
        process.env[apiKeyEnvVar] = originalKey;
      }
    });
  },
);
