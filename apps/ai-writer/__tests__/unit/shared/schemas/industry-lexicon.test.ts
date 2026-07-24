/**
 * Layer 1 tests for industry-lexicon schema (業界標準語彙 SSoT の canonical spec 検証).
 *
 * Focus:
 * - EXPECTED_CATEGORY_KEYS が BOSS 承認済 5 カテゴリを網羅
 * - IndustryLexiconConfigSchema の schema shape 検証 (inline fixture、実 YAML 非依存 = CI-safe)
 * - terms / templates の shape 分岐 (world_view のみ templates、混同は reject)
 * - カテゴリ欠落・空 terms の reject (BOSS の Sprint 毎追記運用の regression guard)
 */

import {
  EXPECTED_CATEGORY_KEYS,
  IndustryLexiconConfigSchema,
} from '@revolution/schemas/industry-lexicon';

describe('EXPECTED_CATEGORY_KEYS (BOSS 承認済 5 カテゴリ)', () => {
  it('covers the 5 approved categories in order', () => {
    expect(EXPECTED_CATEGORY_KEYS).toEqual([
      'menu_expressions',
      'goods_expressions',
      'visual_style',
      'world_view',
      'honorifics',
    ]);
  });
});

describe('IndustryLexiconConfigSchema', () => {
  /**
   * industry-lexicon.yaml の内容をミラーした inline fixture。
   * 実 YAML (templates/ 配下、gitignored sync 派生コピー) は CI に存在しないため読まない。
   */
  const termsCategory = { description: 'test category', terms: ['term1'] };
  const templatesCategory = { description: 'test category', templates: ['{キャラクター名}らをイメージした'] };

  const validConfig = {
    version: '1.0.0',
    last_updated: '2026-07-21',
    categories: {
      menu_expressions: termsCategory,
      goods_expressions: termsCategory,
      visual_style: termsCategory,
      world_view: templatesCategory,
      honorifics: termsCategory,
    },
  };

  it('parses a valid config', () => {
    const result = IndustryLexiconConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects invalid semver in version', () => {
    const result = IndustryLexiconConfigSchema.safeParse({ ...validConfig, version: 'v1' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format in last_updated', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      last_updated: '21-07-2026',
    });
    expect(result.success).toBe(false);
  });

  it.each(EXPECTED_CATEGORY_KEYS)('rejects config missing category "%s"', (key) => {
    const categories: Record<string, unknown> = { ...validConfig.categories };
    delete categories[key];
    const result = IndustryLexiconConfigSchema.safeParse({ ...validConfig, categories });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra category (typo 併存の silent drop 防止)', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      categories: {
        ...validConfig.categories,
        menuu_expressions: termsCategory,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty terms array', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      categories: {
        ...validConfig.categories,
        menu_expressions: { description: 'test', terms: [] },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty templates array in world_view', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      categories: {
        ...validConfig.categories,
        world_view: { description: 'test', templates: [] },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects world_view with terms instead of templates (shape 混同)', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      categories: {
        ...validConfig.categories,
        world_view: termsCategory,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects terms category with templates instead of terms (shape 混同)', () => {
    const result = IndustryLexiconConfigSchema.safeParse({
      ...validConfig,
      categories: {
        ...validConfig.categories,
        honorifics: templatesCategory,
      },
    });
    expect(result.success).toBe(false);
  });
});
