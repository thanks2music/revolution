/**
 * Unit Tests for Vision API Utility Functions
 *
 * @description
 * Tests for Vision API utility functions:
 * - Cross-check logic (HTML vs Vision API validation)
 * - Hallucination detection
 * - Fallback level selection (A/B/C)
 * - Business rule validation
 *
 * @package revolution
 * @module utils/__tests__/vision-api-utils
 */

import {
  crossCheckVisionResult,
  detectHallucination,
  selectFallbackLevel,
  validateBusinessRules,
  type HtmlExtractionData,
} from '../vision-api-utils';
import type {
  VisionExtractionResult,
  MenuItem,
  GoodsItem,
  NoveltyItem,
} from '@/lib/types/vision-api';

describe('Vision API Utilities', () => {
  /**
   * Helper function to create mock Vision API result
   */
  function createMockVisionResult(
    overrides: Partial<VisionExtractionResult['visionExtraction']> = {}
  ): VisionExtractionResult {
    return {
      visionExtraction: {
        confidence: 0.9,
        provider: 'openai',
        timestamp: new Date().toISOString(),
        menuItems: [],
        goodsItems: [],
        noveltyItems: [],
        metadata: {
          hasComingSoonNotice: false,
          totalImagesAnalyzed: 1,
        },
        ...overrides,
      },
    };
  }

  /**
   * Helper function to create mock HTML extraction data
   */
  function createMockHtmlExtraction(
    overrides: Partial<HtmlExtractionData> = {}
  ): HtmlExtractionData {
    return {
      menuItemCount: 5,
      priceCount: 3,
      htmlSufficiencyRate: 0.6,
      ...overrides,
    };
  }

  describe('crossCheckVisionResult', () => {
    describe('Issue 1: Coming Soon Fabrication', () => {
      it('should detect hallucination when Coming Soon notice exists but menu items were generated', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'テストメニュー', price: 1000, characterName: [] },
            { name: 'テストメニュー2', price: 1500, characterName: [] },
          ],
          metadata: {
            hasComingSoonNotice: true,
            totalImagesAnalyzed: 1,
          },
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toContain('Hallucination detected');
        expect(result.issues[0]).toContain('Coming Soon');
      });

      it('should pass when Coming Soon notice exists and no menu items generated', () => {
        const visionResult = createMockVisionResult({
          menuItems: [],
          metadata: {
            hasComingSoonNotice: true,
            totalImagesAnalyzed: 1,
          },
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(true);
        expect(result.issues).toHaveLength(0);
      });
    });

    describe('Issue 2: Excessive Detail Without HTML', () => {
      it('should detect suspicious extraction when no HTML data but excessive Vision items', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array(8).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toContain('Suspicious');
        expect(result.issues[0]).toContain('without any HTML data');
      });

      it('should pass when no HTML data but reasonable Vision item count', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array(3).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(true);
        expect(result.issues).toHaveLength(0);
      });
    });

    describe('Issue 3: Confidence Inconsistency', () => {
      it('should detect inconsistency when high confidence but very low HTML sufficiency', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: Array(5).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
          htmlSufficiencyRate: 0.05, // 5%
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toContain('Confidence inconsistency');
      });

      it('should pass when high confidence and reasonable HTML sufficiency', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: Array(5).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 5,
          priceCount: 3,
          htmlSufficiencyRate: 0.6, // 60%
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.passed).toBe(true);
        expect(result.issues).toHaveLength(0);
      });
    });

    describe('Cross-check details', () => {
      it('should return detailed comparison data', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'メニュー1', price: 1000, characterName: [] },
            { name: 'メニュー2', price: 1500, characterName: [] },
          ],
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 3,
          priceCount: 2,
        });

        const result = crossCheckVisionResult(visionResult, htmlExtraction);

        expect(result.details).toBeDefined();
        expect(result.details.htmlMenuCount).toBe(3);
        expect(result.details.visionMenuCount).toBe(2);
        expect(result.details.htmlPriceCount).toBe(2);
        expect(result.details.visionPriceCount).toBe(2);
        expect(result.details.hasComingSoonNotice).toBe(false);
        expect(result.details.confidenceScore).toBe(0.9);
      });
    });
  });

  describe('detectHallucination', () => {
    describe('Type 1: Coming Soon Fabrication', () => {
      it('should detect Coming Soon fabrication', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array(5).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
          metadata: {
            hasComingSoonNotice: true,
            totalImagesAnalyzed: 1,
          },
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(true);
        expect(result.type).toBe('coming_soon_fabrication');
        expect(result.reason).toContain('Coming Soon');
        expect(result.confidence).toBe(0.9);
      });

      it('should not detect when Coming Soon but no menu items', () => {
        const visionResult = createMockVisionResult({
          menuItems: [],
          metadata: {
            hasComingSoonNotice: true,
            totalImagesAnalyzed: 1,
          },
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(false);
      });
    });

    describe('Type 2: Excessive Detail Without HTML', () => {
      it('should detect excessive detail without HTML', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array(15).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(true);
        expect(result.type).toBe('excessive_detail_without_html');
        expect(result.reason).toContain('without any HTML data');
      });

      it('should not detect when menu items count is reasonable', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array(8).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(false);
      });
    });

    describe('Type 3: Confidence Inconsistency', () => {
      it('should detect confidence inconsistency', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.95, // Very high
          menuItems: Array(5).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 0,
          priceCount: 0,
          htmlSufficiencyRate: 0.03, // Very low (3%)
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(true);
        expect(result.type).toBe('confidence_inconsistency');
        expect(result.reason).toContain('High confidence');
        expect(result.reason).toContain('HTML sufficiency is very low');
      });

      it('should not detect when confidence matches HTML sufficiency', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.7, // Medium
          menuItems: Array(3).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 2,
          priceCount: 1,
          htmlSufficiencyRate: 0.4, // Medium (40%)
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(false);
      });
    });

    describe('No hallucination cases', () => {
      it('should not detect hallucination for valid extraction', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.85,
          menuItems: Array(5).fill({ name: 'テストメニュー', price: 1000, characterName: [] }),
        });

        const htmlExtraction = createMockHtmlExtraction({
          menuItemCount: 4,
          priceCount: 3,
          htmlSufficiencyRate: 0.6,
        });

        const result = detectHallucination(visionResult, htmlExtraction);

        expect(result.detected).toBe(false);
        expect(result.type).toBeUndefined();
        expect(result.reason).toBeUndefined();
      });
    });
  });

  describe('selectFallbackLevel', () => {
    describe('Level A: Detailed extraction', () => {
      it('should select Level A when confidence >= 0.85 and has menu items', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: [
            { name: 'メニュー1', price: 1000, characterName: [] },
            { name: 'メニュー2', price: 1500, characterName: [] },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('A');
      });

      it('should select Level A when confidence >= 0.85 and has goods items', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.88,
          goodsItems: [
            { name: 'グッズ1', price: 2000, variantCount: 3 },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('A');
      });

      it('should select Level A at confidence boundary (0.85)', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.85,
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('A');
      });
    });

    describe('Level B: Partial extraction', () => {
      it('should select Level B when confidence in range and has character names', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.75,
          menuItems: [
            { name: 'メニュー1', characterName: ['キャラクター1'] },
            { name: 'メニュー2', characterName: ['キャラクター2'] },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });

      it('should select Level B at lower boundary (0.70)', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.70,
          menuItems: [{ name: 'メニュー', characterName: ['キャラクター'] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });

      it('should not select Level B when no character names despite confidence range', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.75,
          menuItems: [{ name: 'メニュー1', characterName: [] }, { name: 'メニュー2', characterName: [] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C'); // Falls back to C
      });

      it('should select Level B when goods items have character names', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.78,
          goodsItems: [{ name: 'グッズ', characterName: ['キャラクター'] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });
    });

    describe('Level C: Generic expression', () => {
      it('should select Level C when confidence < 0.70', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.65,
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C');
      });

      it('should select Level C when confidence high but no items', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: [],
          goodsItems: [],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C');
      });

      it('should select Level C at confidence boundary (0.69)', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.69,
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [] }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C');
      });
    });
  });

  describe('validateBusinessRules', () => {
    describe('Menu price validation', () => {
      it('should detect menu prices below minimum (500円)', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'メニュー1', price: 300, characterName: [] }, // Too low
            { name: 'メニュー2', price: 1000, characterName: [] },
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Menu price out of range');
        expect(result.issues[0]).toContain('300円');
        expect(result.adjustedConfidence).toBeLessThan(0.9);
      });

      it('should detect menu prices above maximum (5000円)', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'メニュー1', price: 6000, characterName: [] }, // Too high
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Menu price out of range');
        expect(result.issues[0]).toContain('6000円');
      });

      it('should pass when menu prices are within range', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'メニュー1', price: 800, characterName: [] },
            { name: 'メニュー2', price: 1500, characterName: [] },
            { name: 'メニュー3', price: 3000, characterName: [] },
          ],
        });

        const result = validateBusinessRules(visionResult);

        const menuPriceIssues = result.issues.filter(issue => issue.includes('Menu price'));
        expect(menuPriceIssues).toHaveLength(0);
      });
    });

    describe('Goods price validation', () => {
      it('should detect goods prices below minimum (300円)', () => {
        const visionResult = createMockVisionResult({
          goodsItems: [
            { name: 'グッズ1', price: 200 }, // Too low
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Goods price out of range');
        expect(result.issues[0]).toContain('200円');
      });

      it('should detect goods prices above maximum (10000円)', () => {
        const visionResult = createMockVisionResult({
          goodsItems: [
            { name: 'グッズ1', price: 15000 }, // Too high
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Goods price out of range');
        expect(result.issues[0]).toContain('15000円');
      });
    });

    describe('Variant count validation', () => {
      it('should detect suspicious goods variant count (> 100)', () => {
        const visionResult = createMockVisionResult({
          goodsItems: [
            { name: 'グッズ1', variantCount: 150 }, // Suspicious
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Goods variant count suspicious');
        expect(result.issues[0]).toContain('150 variants');
      });

      it('should detect suspicious novelty variant count (> 50)', () => {
        const visionResult = createMockVisionResult({
          noveltyItems: [
            {
              name: 'ノベルティ',
              condition: '1ドリンク注文につき1枚',
              variantCount: 80, // Suspicious
            },
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('Novelty variant count suspicious');
        expect(result.issues[0]).toContain('80 variants');
      });

      it('should pass when variant counts are reasonable', () => {
        const visionResult = createMockVisionResult({
          goodsItems: [
            { name: 'グッズ1', variantCount: 5 },
            { name: 'グッズ2', variantCount: 12 },
          ],
          noveltyItems: [
            {
              name: 'ノベルティ',
              condition: '1ドリンク注文につき1枚',
              variantCount: 10,
            },
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues).toHaveLength(0);
        expect(result.adjustedConfidence).toBe(0.9);
      });
    });

    describe('Confidence adjustment', () => {
      it('should apply penalty for multiple violations', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: [
            { name: 'メニュー1', price: 300, characterName: [] }, // -0.05 penalty
            { name: 'メニュー2', price: 6000, characterName: [] }, // -0.05 penalty
          ],
          goodsItems: [
            { name: 'グッズ1', variantCount: 150 }, // -0.10 penalty
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBe(3);
        expect(result.adjustedConfidence).toBeCloseTo(0.7, 2); // 0.9 - 0.2 = 0.7
      });

      it('should not allow adjusted confidence below 0', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.1,
          menuItems: Array(10).fill({ name: 'メニュー', price: 100, characterName: [] }), // Heavy penalty
        });

        const result = validateBusinessRules(visionResult);

        expect(result.adjustedConfidence).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
