/**
 * Unit Tests for Vision API Utility Functions
 *
 * @description
 * Tests for Vision API utility functions:
 * - Hallucination detection (Coming Soon のみ。2026-10-11)
 * - Fallback level selection (A/B/C)
 * - Business rule validation
 *
 * @package revolution
 * @module utils/__tests__/vision-api-utils
 */

import {
  detectHallucination,
  selectFallbackLevel,
  validateBusinessRules,
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

  describe('detectHallucination', () => {
    describe('Type 1: Coming Soon Fabrication', () => {
      it('should detect Coming Soon fabrication', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array<MenuItem>(5).fill({ name: 'テストメニュー', price: 1000, characterName: [], hasNovelty: false }),
          metadata: {
            hasComingSoonNotice: true,
            totalImagesAnalyzed: 1,
          },
        });

        const result = detectHallucination(visionResult);

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

        const result = detectHallucination(visionResult);

        expect(result.detected).toBe(false);
      });
    });

    describe('以前の Type 2 / 3 は検出しない (Vision は HTML の欠けを埋めるために呼ぶため、2026-10-11)', () => {
      it('HTML にメニューが無く Vision が 15 品を出しても検出しない', () => {
        const visionResult = createMockVisionResult({
          menuItems: Array<MenuItem>(15).fill({ name: 'テストメニュー', price: 1000, characterName: [], hasNovelty: false }),
        });

        expect(detectHallucination(visionResult).detected).toBe(false);
      });

      it('確信度が高くても Coming Soon でなければ検出しない', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.95,
          menuItems: Array<MenuItem>(5).fill({ name: 'テストメニュー', price: 1000, characterName: [], hasNovelty: false }),
        });

        expect(detectHallucination(visionResult).detected).toBe(false);
      });
    });

    describe('No hallucination cases', () => {
      it('should not detect hallucination for valid extraction', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.85,
          menuItems: Array<MenuItem>(5).fill({ name: 'テストメニュー', price: 1000, characterName: [], hasNovelty: false }),
        });

        const result = detectHallucination(visionResult);

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
            { name: 'メニュー1', price: 1000, characterName: [], hasNovelty: false },
            { name: 'メニュー2', price: 1500, characterName: [], hasNovelty: false },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('A');
      });

      it('should select Level A when confidence >= 0.85 and has goods items', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.88,
          goodsItems: [
            { name: 'グッズ1', price: 2000, variantCount: 3, characterName: [], isRandomSale: false },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('A');
      });

      it('should select Level A at confidence boundary (0.85)', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.85,
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [], hasNovelty: false }],
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
            { name: 'メニュー1', characterName: ['キャラクター1'], hasNovelty: false },
            { name: 'メニュー2', characterName: ['キャラクター2'], hasNovelty: false },
          ],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });

      it('should select Level B at lower boundary (0.70)', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.70,
          menuItems: [{ name: 'メニュー', characterName: ['キャラクター'], hasNovelty: false }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });

      it('should not select Level B when no character names despite confidence range', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.75,
          menuItems: [{ name: 'メニュー1', characterName: [], hasNovelty: false }, { name: 'メニュー2', characterName: [], hasNovelty: false }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C'); // Falls back to C
      });

      it('should select Level B when goods items have character names', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.78,
          goodsItems: [{ name: 'グッズ', characterName: ['キャラクター'], isRandomSale: false }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('B');
      });
    });

    describe('Level C: Generic expression', () => {
      it('should select Level C when confidence < 0.70', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.65,
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [], hasNovelty: false }],
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
          menuItems: [{ name: 'メニュー', price: 1000, characterName: [], hasNovelty: false }],
        });

        const level = selectFallbackLevel(visionResult);

        expect(level).toBe('C');
      });
    });
  });

  describe('Templates v1.2 alignment (PR-B / Sprint 3 step 3)', () => {
    describe('selectFallbackLevel: novelty-only extraction', () => {
      it('should reach Level A when noveltyItems are extracted alone with high confidence', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.9,
          menuItems: [],
          goodsItems: [],
          noveltyItems: [
            {
              name: 'イラストカード',
              condition: 'メニュー1品注文につき1枚',
              characterName: ['五条悟'],
              isRandom: true,
            },
          ],
        });
        expect(selectFallbackLevel(visionResult)).toBe('A');
      });

      it('should reach Level B when noveltyItems carry character names with medium confidence', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.75,
          menuItems: [],
          goodsItems: [],
          noveltyItems: [
            {
              name: 'イラストカード',
              characterName: ['五条悟'],
              isRandom: false,
            },
          ],
        });
        expect(selectFallbackLevel(visionResult)).toBe('B');
      });
    });

    describe('detectHallucination Type 1: covers goods/novelty per Templates v1.2', () => {
      it('detects Coming Soon fabrication when only goodsItems were extracted', () => {
        const visionResult = createMockVisionResult({
          menuItems: [],
          goodsItems: [{ name: 'グッズ1', characterName: [], isRandomSale: false }],
          metadata: { hasComingSoonNotice: true, totalImagesAnalyzed: 1 },
        });

        const result = detectHallucination(visionResult);

        expect(result.detected).toBe(true);
        expect(result.type).toBe('coming_soon_fabrication');
        expect(result.reason).toContain('goods=1');
      });

      it('detects Coming Soon fabrication when only noveltyItems were extracted', () => {
        const visionResult = createMockVisionResult({
          menuItems: [],
          noveltyItems: [{ name: 'ノベルティ1', characterName: [], isRandom: false }],
          metadata: { hasComingSoonNotice: true, totalImagesAnalyzed: 1 },
        });

        const result = detectHallucination(visionResult);

        expect(result.detected).toBe(true);
        expect(result.type).toBe('coming_soon_fabrication');
        expect(result.reason).toContain('novelty=1');
      });
    });
  });

  describe('validateBusinessRules', () => {
    describe('Menu price validation', () => {
      it('should detect menu prices below minimum (500円)', () => {
        const visionResult = createMockVisionResult({
          menuItems: [
            { name: 'メニュー1', price: 300, characterName: [], hasNovelty: false }, // Too low
            { name: 'メニュー2', price: 1000, characterName: [], hasNovelty: false },
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
            { name: 'メニュー1', price: 6000, characterName: [], hasNovelty: false }, // Too high
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
            { name: 'メニュー1', price: 800, characterName: [], hasNovelty: false },
            { name: 'メニュー2', price: 1500, characterName: [], hasNovelty: false },
            { name: 'メニュー3', price: 3000, characterName: [], hasNovelty: false },
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
            { name: 'グッズ1', price: 200, characterName: [], isRandomSale: false }, // Too low
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
            { name: 'グッズ1', price: 15000, characterName: [], isRandomSale: false }, // Too high
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
            { name: 'グッズ1', variantCount: 150, characterName: [], isRandomSale: false }, // Suspicious
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
              characterName: [],
              isRandom: false,
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
            { name: 'グッズ1', variantCount: 5, characterName: [], isRandomSale: false },
            { name: 'グッズ2', variantCount: 12, characterName: [], isRandomSale: false },
          ],
          noveltyItems: [
            {
              name: 'ノベルティ',
              condition: '1ドリンク注文につき1枚',
              variantCount: 10,
              characterName: [],
              isRandom: false,
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
            { name: 'メニュー1', price: 300, characterName: [], hasNovelty: false }, // -0.05 penalty
            { name: 'メニュー2', price: 6000, characterName: [], hasNovelty: false }, // -0.05 penalty
          ],
          goodsItems: [
            { name: 'グッズ1', variantCount: 150, characterName: [], isRandomSale: false }, // -0.10 penalty
          ],
        });

        const result = validateBusinessRules(visionResult);

        expect(result.issues.length).toBe(3);
        expect(result.adjustedConfidence).toBeCloseTo(0.7, 2); // 0.9 - 0.2 = 0.7
      });

      it('should not allow adjusted confidence below 0', () => {
        const visionResult = createMockVisionResult({
          confidence: 0.1,
          menuItems: Array<MenuItem>(10).fill({ name: 'メニュー', price: 100, characterName: [], hasNovelty: false }), // Heavy penalty
        });

        const result = validateBusinessRules(visionResult);

        expect(result.adjustedConfidence).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
