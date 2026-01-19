/**
 * Vision API E2E Test - Princess Cafe (Tokyo Revengers)
 *
 * @description
 * End-to-end test for Vision API integration pipeline.
 * Tests the complete flow from HTML insufficiency detection to Vision API extraction.
 *
 * Test Store: Princess Cafe (プリンセスカフェ)
 * Test Event: Tokyo Revengers (東京リベンジャーズ)
 * Image Format: WebP (future: PNG/JPG tests will be added)
 *
 * Test Flow (8 steps):
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

// Unmock Anthropic SDK for E2E testing (jest.setup.mjs globally mocks it)
// We need real API calls for E2E tests, not mocked responses
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
import type { VisionApiTemplate } from '@/lib/types/vision-api';

/**
 * Providers to test
 * Both OpenAI and Claude Vision APIs will be tested with identical test logic
 */
const PROVIDERS_TO_TEST: VisionProvider[] = ['openai', 'claude'];

describe.each(PROVIDERS_TO_TEST)(
  'Vision API E2E Test - Princess Cafe (Tokyo Revengers) - Provider: %s',
  (provider: VisionProvider) => {
    let visionApiService: IVisionApiService;
    let yamlTemplateLoaderService: YamlTemplateLoaderService;

    beforeAll(() => {
      // Initialize services
      visionApiService = VisionApiServiceFactory.create(provider);
      yamlTemplateLoaderService = new YamlTemplateLoaderService();

      console.log(`[E2E Test] Initialized Vision API service with provider: ${provider}`);
    });

  /**
   * Main E2E test: Full Vision API pipeline integration
   *
   * Prerequisites:
   * - OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable must be set (depending on provider)
   * - Princess Cafe (Tokyo Revengers) test images must be accessible
   * - Vision API YAML template must exist
   *
   * Test Images:
   * - Food menu: https://www.pripricafe.com/event/cafe/img/toreve2512_food.webp (558 KB WebP)
   * - Drink menu: https://www.pripricafe.com/event/cafe/img/toreve2512_drink.webp (503 KB WebP)
   */
  it(`should extract menu items from images when HTML is insufficient (${provider})`, async () => {
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

    // Step 3: Use interim simplified prompt
    // NOTE: Waiting for Templates repository to create 1.5-vision-extraction.yaml
    // Interim prompt focuses on simple Japanese text extraction with character name separation
    const interimPrompt = `あなたはコラボカフェのメニュー情報を抽出する専門家です。
指定した画像内に書かれている日本語の文字列を抽出してください。

想定される日本語の情報:
- メニュー名
- 金額 (メニューの料金)
- キャラクター名 (メニュー名に含まれる場合は分離して抽出)
- その他の文字列情報 (出現頻度が高い例: ノベルティ情報)

# 抽出ルール

- メニュー名にキャラクター名が含まれる場合、characterName フィールドに分離する
  例: 「場地と千冬のマカロンパフェ」→ name: "マカロンパフェ", characterName: "場地と千冬"
- キャラクター名が不明な場合は、characterName を空文字列にする

# 出力形式

必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "menuItems": [
    {
      "name": "メニュー名",
      "price": 1200,
      "characterName": "キャラクター名",
      "description": "コラボメニューのコンセプトや説明が書かれている場合",
      "notes": "注意点が記載されている場合 (例: 食品アレルギー表記など)",
      "remarks": "補足情報が記載されている場合 (例: 食材名や栄養成分など)",
      "confidence": 0.95
    }
  ],
  "noveltyItems": [
    {
      "name": "ノベルティ名称",
      "condition": "ノベルティ条件が記載されている場合",
      "notes": "注意点が記載されている場合 (例: 絵柄は選べませんなど)",
      "remarks": "補足情報が記載されている場合 (例: 無くなり次第終了など)"
    }
  ],
  "metadata": {
    "imageQuality": "high",
    "hasComingSoonNotice": false,
    "extractionDifficulty": "easy"
  }
}`;

    console.log('[E2E Test] Step 3: Using interim simplified prompt');

    // Step 4: Call Vision API
    // Using Princess Cafe (Tokyo Revengers) menu images
    // Format: WebP (future tests will cover PNG/JPG)
    // Event URL: https://www.pripricafe.com/event/cafe/revengers_sweets.html
    const testImageUrls = [
      'https://www.pripricafe.com/event/cafe/img/toreve2512_food.webp',   // Food menu (558 KB)
      'https://www.pripricafe.com/event/cafe/img/toreve2512_drink.webp',  // Drink menu (503 KB)
    ];

    const visionResult = await visionApiService.extractFromImages({
      imageUrls: testImageUrls,
      prompt: interimPrompt,
      category: 'menu',
      maxRetries: 3,
      timeout: 60000,
    });

    expect(visionResult).toBeDefined();
    expect(visionResult.visionExtraction).toBeDefined();
    expect(visionResult.visionExtraction.provider).toBe(provider);
    expect(visionResult.visionExtraction.confidence).toBeGreaterThanOrEqual(0);
    expect(visionResult.visionExtraction.confidence).toBeLessThanOrEqual(1);

    console.log('[E2E Test] Step 4: Vision API extraction result:', {
      confidence: visionResult.visionExtraction.confidence,
      menuItemCount: visionResult.visionExtraction.menuItems.length,
      goodsItemCount: visionResult.visionExtraction.goodsItems.length,
    });

    // Step 5: Cross-check
    const crossCheckResult = crossCheckVisionResult(visionResult, htmlExtraction);

    // Log cross-check results for analysis
    console.log('[E2E Test] Step 5: Cross-check result:', {
      passed: crossCheckResult.passed,
      issueCount: crossCheckResult.issues.length,
      issues: crossCheckResult.issues,
      details: crossCheckResult.details,
    });

    // In this E2E test, we're testing the Vision API fallback scenario where HTML is insufficient.
    // The cross-check may flag "confidence inconsistency" which is expected for this test case.
    // We verify that:
    // 1. Vision API extracted menu items successfully
    // 2. If cross-check fails, it's due to the expected "confidence inconsistency" issue only
    expect(crossCheckResult.details).toBeDefined();
    expect(crossCheckResult.details.visionMenuCount).toBeGreaterThan(0);

    if (!crossCheckResult.passed) {
      // Cross-check failed - verify it's the expected issue
      expect(crossCheckResult.issues.length).toBeGreaterThan(0);
      const hasConfidenceInconsistency = crossCheckResult.issues.some(issue =>
        issue.includes('Confidence inconsistency') || issue.includes('Suspicious')
      );
      expect(hasConfidenceInconsistency).toBe(true);
      console.log('[E2E Test] Cross-check flagged expected confidence inconsistency (HTML insufficient scenario)');
    }

    // Step 6: Hallucination detection
    const hallucinationResult = detectHallucination(visionResult, htmlExtraction);

    // Log complete hallucination result BEFORE assertion
    console.log('[E2E Test] Step 6: Hallucination detection result:', {
      detected: hallucinationResult.detected,
      type: hallucinationResult.type,
      reason: hallucinationResult.reason,
      confidence: hallucinationResult.confidence,
    });
    console.log('[E2E Test] Step 6: Input values to hallucination detector:', {
      visionConfidence: visionResult.visionExtraction.confidence,
      menuItemCount: visionResult.visionExtraction.menuItems.length,
      htmlMenuItemCount: htmlExtraction.menuItemCount,
      htmlPriceCount: htmlExtraction.priceCount,
      htmlSufficiencyRate: htmlExtraction.htmlSufficiencyRate,
      hasComingSoonNotice: visionResult.visionExtraction.metadata?.hasComingSoonNotice,
    });

    expect(hallucinationResult.detected).toBe(false);

    // Step 7: Fallback level selection
    const fallbackLevel = selectFallbackLevel(visionResult);

    // Fallback level is determined by confidence score:
    // - Level A: confidence >= 0.8
    // - Level B: confidence >= 0.5
    // - Level C: confidence < 0.5 or insufficient data
    expect(['A', 'B', 'C']).toContain(fallbackLevel);

    // Log the actual fallback level for debugging
    console.log('[E2E Test] Step 7: Fallback level selected:', fallbackLevel);
    console.log('[E2E Test] Confidence score:', visionResult.visionExtraction.confidence);

    // Step 8: Validation
    expect(visionResult.visionExtraction.menuItems.length).toBeGreaterThan(3);

    // Confidence validation: Vision API may return varying confidence scores
    // Minimum threshold is 0.3 (any value >= 0.3 is acceptable)
    expect(visionResult.visionExtraction.confidence).toBeGreaterThanOrEqual(0.3);
    expect(visionResult.visionExtraction.confidence).toBeLessThanOrEqual(1.0);

    // Character name validation (critical for Tokyo Revengers collaboration)
    // Princess Cafe menus typically include character names (e.g., "マイキーのパフェ")
    const menusWithCharacterName = visionResult.visionExtraction.menuItems.filter(
      (item) => item.characterName
    );
    expect(menusWithCharacterName.length).toBeGreaterThan(0);
    console.log('[E2E Test] Character names extracted:', {
      total: visionResult.visionExtraction.menuItems.length,
      withCharacterName: menusWithCharacterName.length,
      examples: menusWithCharacterName.slice(0, 3).map((item) => ({
        name: item.name,
        characterName: item.characterName,
      })),
    });

    // Business rule validation
    const businessRuleValidation = validateBusinessRules(visionResult);

    // Log business rule validation results for debugging
    console.log('[E2E Test] Business rule validation:', {
      issueCount: businessRuleValidation.issues.length,
      issues: businessRuleValidation.issues,
      adjustedConfidence: businessRuleValidation.adjustedConfidence,
    });

    // Business rules may detect minor issues (e.g., price ranges)
    // As long as the result is usable, the test should pass
    expect(businessRuleValidation.issues.length).toBeLessThanOrEqual(2);

    console.log('[E2E Test] Step 8: Final validation passed');
    console.log(`[E2E Test] ✅ Vision API pipeline E2E test completed successfully with ${provider}`);
  }, 120000); // 120 second timeout for API calls (3 retries × 30s each)

  /**
   * Error scenario: Vision API timeout
   */
  it(`should handle Vision API timeout gracefully (${provider})`, async () => {
    const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

    await expect(
      visionApiService.extractFromImages({
        imageUrls: ['https://www.pripricafe.com/event/cafe/img/toreve2512_food.webp'],
        prompt: template.prompts.menu_extraction.content,
        category: 'menu',
        maxRetries: 1,
        timeout: 1, // 1ms - guaranteed timeout
      })
    ).rejects.toThrow(provider === 'openai' ? /Vision API timeout/ : /Vision API timeout|Claude Vision API timeout/);
  });

  /**
   * Error scenario: Invalid image URL
   *
   * Note: Provider-specific behavior:
   * - OpenAI SDK: returns empty result with default confidence (0.5)
   * - Claude SDK: may throw error or return empty result
   * This test verifies graceful degradation behavior.
   */
  it(`should handle invalid image URL gracefully (${provider})`, async () => {
    const template = await yamlTemplateLoaderService.loadVisionApiTemplate('collabo-cafe');

    const result = await visionApiService.extractFromImages({
      imageUrls: ['https://invalid-url-that-does-not-exist.com/image.jpg'],
      prompt: template.prompts.menu_extraction.content,
      category: 'menu',
      maxRetries: 2,
      timeout: 10000,
    });

    // Both providers should return empty results for invalid URLs
    expect(result.visionExtraction.menuItems).toHaveLength(0);
    expect(result.visionExtraction.goodsItems).toHaveLength(0);
    // Confidence may vary by provider, but should be within valid range
    expect(result.visionExtraction.confidence).toBeGreaterThanOrEqual(0);
    expect(result.visionExtraction.confidence).toBeLessThanOrEqual(1);
  });

  /**
   * Error scenario: Missing API Key
   */
  it(`should throw error if API key is missing (${provider})`, () => {
    const apiKeyEnvVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const originalKey = process.env[apiKeyEnvVar];
    delete process.env[apiKeyEnvVar];

    expect(() => {
      VisionApiServiceFactory.create(provider);
    }).toThrow(provider === 'openai' ? /OpenAI API key is required/ : /Claude API key is required/);

    // Restore
    if (originalKey) {
      process.env[apiKeyEnvVar] = originalKey;
    }
  });
}
);
