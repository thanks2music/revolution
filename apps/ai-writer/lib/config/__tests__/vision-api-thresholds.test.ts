/**
 * Unit tests for Vision API threshold constants and sufficiency check function
 *
 * @package revolution
 * @module config/__tests__/vision-api-thresholds
 */

import {
  VISION_API_THRESHOLDS,
  checkExtractionSufficiency,
  type SufficiencyCheckResult,
} from '../vision-api-thresholds';

describe('VISION_API_THRESHOLDS', () => {
  it('should have correct threshold values based on data analysis', () => {
    expect(VISION_API_THRESHOLDS.MIN_MENU_ITEM_COUNT).toBe(3);
    expect(VISION_API_THRESHOLDS.MIN_PRICE_COUNT).toBe(2);
    expect(VISION_API_THRESHOLDS.MIN_HTML_SUFFICIENCY_RATE).toBe(0.20);
    expect(VISION_API_THRESHOLDS.MIN_IMAGE_COUNT).toBe(3);
  });

  it('should be readonly at TypeScript level (as const)', () => {
    // TypeScript の型チェックで書き込みがコンパイルエラーになることを確認
    // 実行時は JavaScript なので書き込みは可能だが、TypeScript で防止される
    expect(typeof VISION_API_THRESHOLDS.MIN_MENU_ITEM_COUNT).toBe('number');
    expect(Object.isFrozen(VISION_API_THRESHOLDS)).toBe(false); // 'as const' は型レベルの制約
  });
});

describe('checkExtractionSufficiency', () => {
  describe('Vision API が必要な場合（isSufficient = false）', () => {
    it('should return false when menu item count is below threshold', () => {
      const result = checkExtractionSufficiency(
        2, // < 3 (閾値未満)
        5, // >= 2 (閾値以上)
        0.80 // >= 0.20 (閾値以上)
      );

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
      expect(result.details.menuItemCount).toBe(2);
    });

    it('should return false when price count is below threshold', () => {
      const result = checkExtractionSufficiency(
        5, // >= 3 (閾値以上)
        1, // < 2 (閾値未満)
        0.80 // >= 0.20 (閾値以上)
      );

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
      expect(result.details.priceCount).toBe(1);
    });

    it('should return false when HTML sufficiency rate is below threshold', () => {
      const result = checkExtractionSufficiency(
        5, // >= 3 (閾値以上)
        5, // >= 2 (閾値以上)
        0.15 // < 0.20 (閾値未満)
      );

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
      expect(result.details.htmlSufficiencyRate).toBe(0.15);
    });

    it('should return false when multiple conditions are below threshold', () => {
      const result = checkExtractionSufficiency(
        0, // < 3 (閾値未満)
        0, // < 2 (閾値未満)
        0.05 // < 0.20 (閾値未満)
      );

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
      expect(result.details.menuItemCount).toBe(0);
      expect(result.details.priceCount).toBe(0);
      expect(result.details.htmlSufficiencyRate).toBe(0.05);
    });
  });

  describe('Vision API が不要な場合（isSufficient = true）', () => {
    it('should return true when all conditions meet thresholds', () => {
      const result = checkExtractionSufficiency(
        5, // >= 3 (閾値以上)
        5, // >= 2 (閾値以上)
        0.80 // >= 0.20 (閾値以上)
      );

      expect(result.isSufficient).toBe(true);
      expect(result.reason).toContain('HTML extraction sufficient');
      expect(result.details.menuItemCount).toBe(5);
      expect(result.details.priceCount).toBe(5);
      expect(result.details.htmlSufficiencyRate).toBe(0.80);
    });

    it('should return true when conditions exactly match thresholds', () => {
      const result = checkExtractionSufficiency(
        3, // = 3 (閾値と同じ)
        2, // = 2 (閾値と同じ)
        0.20 // = 0.20 (閾値と同じ)
      );

      expect(result.isSufficient).toBe(true);
      expect(result.reason).toContain('HTML extraction sufficient');
    });

    it('should return true for high-quality HTML extraction', () => {
      const result = checkExtractionSufficiency(
        10, // >> 3 (閾値を大きく上回る)
        10, // >> 2 (閾値を大きく上回る)
        0.95 // >> 0.20 (閾値を大きく上回る)
      );

      expect(result.isSufficient).toBe(true);
      expect(result.reason).toContain('HTML extraction sufficient');
    });
  });

  describe('境界値テスト', () => {
    it('should handle menu item count at boundary (2 vs 3)', () => {
      const insufficient = checkExtractionSufficiency(2, 5, 0.80);
      const sufficient = checkExtractionSufficiency(3, 5, 0.80);

      expect(insufficient.isSufficient).toBe(false);
      expect(sufficient.isSufficient).toBe(true);
    });

    it('should handle price count at boundary (1 vs 2)', () => {
      const insufficient = checkExtractionSufficiency(5, 1, 0.80);
      const sufficient = checkExtractionSufficiency(5, 2, 0.80);

      expect(insufficient.isSufficient).toBe(false);
      expect(sufficient.isSufficient).toBe(true);
    });

    it('should handle HTML sufficiency rate at boundary (19% vs 20%)', () => {
      const insufficient = checkExtractionSufficiency(5, 5, 0.19);
      const sufficient = checkExtractionSufficiency(5, 5, 0.20);

      expect(insufficient.isSufficient).toBe(false);
      expect(sufficient.isSufficient).toBe(true);
    });
  });

  describe('実データに基づくシナリオテスト', () => {
    it('should correctly identify eeo Cafe scenario (all zeros)', () => {
      // eeo Cafe: メニュー 0件、価格 0件、充足度 5%
      const result = checkExtractionSufficiency(0, 0, 0.05);

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
    });

    it('should correctly identify Sweets Paradise scenario (partially available)', () => {
      // Sweets Paradise: メニュー 0件、価格 1件、充足度 15%
      const result = checkExtractionSufficiency(0, 1, 0.15);

      expect(result.isSufficient).toBe(false);
      expect(result.reason).toContain('Vision API required');
    });

    it('should correctly identify high-quality HTML scenario', () => {
      // 理想的なHTML: メニュー 10件、価格 10件、充足度 90%
      const result = checkExtractionSufficiency(10, 10, 0.90);

      expect(result.isSufficient).toBe(true);
      expect(result.reason).toContain('HTML extraction sufficient');
    });
  });

  describe('オプショナルな画像数の扱い', () => {
    it('should include image count in details when provided', () => {
      const result = checkExtractionSufficiency(5, 5, 0.80, 15);

      expect(result.details.imageCount).toBe(15);
    });

    it('should not include image count in details when omitted', () => {
      const result = checkExtractionSufficiency(5, 5, 0.80);

      expect(result.details.imageCount).toBeUndefined();
    });

    it('should not affect sufficiency determination', () => {
      const withImage = checkExtractionSufficiency(5, 5, 0.80, 1);
      const withoutImage = checkExtractionSufficiency(5, 5, 0.80);

      expect(withImage.isSufficient).toBe(withoutImage.isSufficient);
      expect(withImage.reason).toBe(withoutImage.reason);
    });
  });

  describe('reason フィールドのフォーマット', () => {
    it('should format reason with percentage for insufficient case', () => {
      const result = checkExtractionSufficiency(0, 0, 0.153);

      expect(result.reason).toContain('15.3%');
    });

    it('should format reason with percentage for sufficient case', () => {
      const result = checkExtractionSufficiency(5, 5, 0.847);

      expect(result.reason).toContain('84.7%');
    });

    it('should include all metrics in reason string', () => {
      const result = checkExtractionSufficiency(2, 1, 0.10);

      expect(result.reason).toContain('menu: 2');
      expect(result.reason).toContain('price: 1');
      expect(result.reason).toContain('sufficiency: 10.0%');
    });
  });

  describe('型安全性の確認', () => {
    it('should return correct type structure', () => {
      const result: SufficiencyCheckResult = checkExtractionSufficiency(
        5,
        5,
        0.80
      );

      expect(result).toHaveProperty('isSufficient');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('details');
      expect(result.details).toHaveProperty('menuItemCount');
      expect(result.details).toHaveProperty('priceCount');
      expect(result.details).toHaveProperty('htmlSufficiencyRate');
    });

    it('should handle numeric edge cases', () => {
      // 0の場合
      const zeroResult = checkExtractionSufficiency(0, 0, 0);
      expect(zeroResult.isSufficient).toBe(false);

      // 1.0 (100%)の場合
      const fullResult = checkExtractionSufficiency(10, 10, 1.0);
      expect(fullResult.isSufficient).toBe(true);
    });
  });
});
