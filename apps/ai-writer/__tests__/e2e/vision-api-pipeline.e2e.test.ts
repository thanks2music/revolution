/**
 * Vision API E2E Test - eeo Cafe
 *
 * @description
 * End-to-end test for Vision API integration pipeline.
 * Tests the complete flow from HTML insufficiency detection to Vision API extraction.
 *
 * Test Flow (7 steps):
 * 1. HTML extraction (insufficient)
 * 2. Sufficiency check
 * 3. Load Vision API template
 * 4. Call Vision API
 * 5. Cross-check
 * 6. Hallucination detection
 * 7. Fallback level selection
 * 8. Validation
 *
 * @package revolution
 * @module __tests__/e2e/vision-api-pipeline
 * @jest-environment node
 */

import { VisionApiService } from '@/lib/services/vision-api.service';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import {
  crossCheckVisionResult,
  detectHallucination,
  selectFallbackLevel,
  validateBusinessRules,
} from '@/lib/utils/vision-api-utils';
import type { HtmlExtractionData } from '@/lib/utils/vision-api-utils';
import type { VisionApiTemplate } from '@/lib/types/vision-api';

describe('Vision API E2E Test - eeo Cafe', () => {
  let visionApiService: VisionApiService;
  let yamlTemplateLoaderService: YamlTemplateLoaderService;

  beforeAll(() => {
    // Initialize services
    visionApiService = new VisionApiService();
    yamlTemplateLoaderService = new YamlTemplateLoaderService();
  });

  /**
   * Main E2E test: Full Vision API pipeline integration
   *
   * Prerequisites:
   * - OPENAI_API_KEY environment variable must be set
   * - eeo Cafe test images must be accessible
   * - Vision API YAML template must exist
   */
  it('should extract menu items from images when HTML is insufficient', async () => {
    // Step 1: HTML extraction (insufficient)
    const htmlExtraction: HtmlExtractionData = {
      menuItemCount: 0,
      priceCount: 0,
      htmlSufficiencyRate: 0.05, // 5% - insufficient
    };

    console.log('[E2E Test] Step 1: HTML extraction result:', htmlExtraction);

    // Step 2: Sufficiency check
    const isSufficient =
      htmlExtraction.menuItemCount >= 3 &&
      htmlExtraction.priceCount >= 2 &&
      htmlExtraction.htmlSufficiencyRate >= 0.2;

    expect(isSufficient).toBe(false);
    console.log('[E2E Test] Step 2: HTML sufficiency check:', { isSufficient });

    // Step 3: Load Vision API template
    const template: VisionApiTemplate =
      await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

    expect(template).toBeDefined();
    expect(template.prompts.menu_extraction).toBeDefined();
    expect(template.prompts.menu_extraction.content).toBeTruthy();

    console.log('[E2E Test] Step 3: Vision API template loaded');

    // Step 4: Call Vision API
    // Note: Using mock URL for test - replace with actual eeo Cafe image URL in integration environment
    const testImageUrls = [
      'https://eeo.today/storage/events/test-menu-image-1.jpg',
      'https://eeo.today/storage/events/test-menu-image-2.jpg',
    ];

    const visionResult = await visionApiService.extractFromImages({
      imageUrls: testImageUrls,
      prompt: template.prompts.menu_extraction.content,
      category: 'menu',
      maxRetries: 3,
      timeout: 30000,
    });

    expect(visionResult).toBeDefined();
    expect(visionResult.visionExtraction).toBeDefined();
    expect(visionResult.visionExtraction.provider).toBe('openai');
    expect(visionResult.visionExtraction.confidence).toBeGreaterThanOrEqual(0);
    expect(visionResult.visionExtraction.confidence).toBeLessThanOrEqual(1);

    console.log('[E2E Test] Step 4: Vision API extraction result:', {
      confidence: visionResult.visionExtraction.confidence,
      menuItemCount: visionResult.visionExtraction.menuItems.length,
      goodsItemCount: visionResult.visionExtraction.goodsItems.length,
    });

    // Step 5: Cross-check
    const crossCheckResult = crossCheckVisionResult(visionResult, htmlExtraction);

    expect(crossCheckResult.passed).toBe(true);
    expect(crossCheckResult.issues).toHaveLength(0);
    expect(crossCheckResult.details).toBeDefined();
    expect(crossCheckResult.details.visionMenuCount).toBeGreaterThan(0);

    console.log('[E2E Test] Step 5: Cross-check result:', {
      passed: crossCheckResult.passed,
      issueCount: crossCheckResult.issues.length,
      details: crossCheckResult.details,
    });

    // Step 6: Hallucination detection
    const hallucinationResult = detectHallucination(visionResult, htmlExtraction);

    expect(hallucinationResult.detected).toBe(false);

    console.log('[E2E Test] Step 6: Hallucination detection result:', {
      detected: hallucinationResult.detected,
      type: hallucinationResult.type,
      reason: hallucinationResult.reason,
    });

    // Step 7: Fallback level selection
    const fallbackLevel = selectFallbackLevel(visionResult);

    expect(fallbackLevel).toBe('A'); // Expecting Level A (detailed extraction)
    expect(['A', 'B', 'C']).toContain(fallbackLevel);

    console.log('[E2E Test] Step 7: Fallback level selected:', fallbackLevel);

    // Step 8: Validation
    expect(visionResult.visionExtraction.menuItems.length).toBeGreaterThan(3);
    expect(visionResult.visionExtraction.confidence).toBeGreaterThan(0.8);

    // Business rule validation
    const businessRuleValidation = validateBusinessRules(visionResult);
    expect(businessRuleValidation.issues.length).toBe(0);

    console.log('[E2E Test] Step 8: Final validation passed');
    console.log('[E2E Test] ✅ Vision API pipeline E2E test completed successfully');
  }, 60000); // 60 second timeout for API calls

  /**
   * Error scenario: Vision API timeout
   */
  it('should handle Vision API timeout gracefully', async () => {
    const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

    await expect(
      visionApiService.extractFromImages({
        imageUrls: ['https://eeo.today/storage/events/test-image.jpg'],
        prompt: template.prompts.menu_extraction.content,
        category: 'menu',
        maxRetries: 1,
        timeout: 1, // 1ms - guaranteed timeout
      })
    ).rejects.toThrow(/Vision API timeout/);
  });

  /**
   * Error scenario: Invalid image URL
   */
  it('should handle invalid image URL gracefully', async () => {
    const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

    await expect(
      visionApiService.extractFromImages({
        imageUrls: ['https://invalid-url-that-does-not-exist.com/image.jpg'],
        prompt: template.prompts.menu_extraction.content,
        category: 'menu',
        maxRetries: 2,
        timeout: 10000,
      })
    ).rejects.toThrow();
  });

  /**
   * Error scenario: Missing OPENAI_API_KEY
   */
  it('should throw error if OPENAI_API_KEY is missing', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => {
      new VisionApiService();
    }).toThrow(/OpenAI API key is required/);

    // Restore
    if (originalKey) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
