/**
 * Layer 1 tests for style-guide schema (文章スタイル SSoT の canonical spec 検証).
 *
 * Focus:
 * - EXPECTED_RULE_IDS が初期 4 Rule を網羅 (Sprint 毎追記時の drift guard)
 * - EXPECTED_SCOPE_VALUES が StyleGuideScopeEnum と完全一致
 * - StyleGuideConfigSchema の schema shape 検証 (inline fixture、実 YAML ファイル非依存 = CI-safe)
 * - rules / few_shot_examples.{good,bad} の空配列 reject (BOSS の Sprint 毎追記運用で
 *   「空にしてしまう」regression を fail-loud)
 */

import {
  EXPECTED_RULE_IDS,
  EXPECTED_SCOPE_VALUES,
  StyleGuideConfigSchema,
  StyleGuideScopeEnum,
} from '@revolution/schemas/style-guide';

describe('EXPECTED_RULE_IDS (Sprint D 第 1 弾 Phase 1 初期 Rule)', () => {
  it('covers the initial 4 rules', () => {
    expect(EXPECTED_RULE_IDS).toEqual([
      'rule_one_sentence_one_topic',
      'rule_industry_lexicon_preferred',
      'rule_redundancy_allowed',
      'rule_clear_information_placement',
    ]);
  });
});

describe('EXPECTED_SCOPE_VALUES', () => {
  it('covers the initial 2 scopes (enum 変更が意図的であることの literal guard)', () => {
    // EXPECTED_SCOPE_VALUES は StyleGuideScopeEnum.options から導出されるため、
    // enum 側の literal 値をここで固定して意図しない scope 追加/削除を検知する。
    expect(EXPECTED_SCOPE_VALUES).toEqual(['lead', 'body_h2_excerpt']);
    expect(StyleGuideScopeEnum.options).toEqual(['lead', 'body_h2_excerpt']);
  });
});

describe('StyleGuideConfigSchema', () => {
  /**
   * style-guide.yaml の内容をミラーした inline fixture。
   * 実 YAML (templates/ 配下、gitignored sync 派生コピー) は CI に存在しないため読まない。
   */
  const validRule = (id: string) => ({
    id,
    scope: ['lead', 'body_h2_excerpt'],
    statement: 'test statement',
    reason: 'test reason',
  });

  const validExample = (id: string) => ({
    id,
    scope: 'lead',
    source: 'test source',
    body: 'test body',
    why: 'test why',
  });

  const validConfig = {
    version: '1.0.0',
    last_updated: '2026-07-21',
    rules: EXPECTED_RULE_IDS.map((id) => validRule(id)),
    few_shot_examples: {
      good: [validExample('example_good_test')],
      bad: [validExample('example_bad_test')],
    },
  };

  it('parses a valid config', () => {
    const result = StyleGuideConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects invalid semver in version', () => {
    const result = StyleGuideConfigSchema.safeParse({ ...validConfig, version: '1.0' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format in last_updated', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      last_updated: '2026/07/21',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty rules array', () => {
    const result = StyleGuideConfigSchema.safeParse({ ...validConfig, rules: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty good examples array', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      few_shot_examples: { ...validConfig.few_shot_examples, good: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty bad examples array', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      few_shot_examples: { ...validConfig.few_shot_examples, bad: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects rule id without "rule_" prefix', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      rules: [validRule('one_sentence_one_topic')],
    });
    expect(result.success).toBe(false);
  });

  it('rejects example id without "example_" prefix', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      few_shot_examples: {
        good: [validExample('good_test')],
        bad: [validExample('example_bad_test')],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown scope value', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      rules: [{ ...validRule('rule_test'), scope: ['frontmatter'] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra key at top level (.strict())', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      few_shot_example: validConfig.few_shot_examples,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra field in a rule (.strict()、rename 漏れ検知)', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      rules: [{ ...validRule('rule_test'), statment: 'typo field' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra field in an example (.strict())', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      few_shot_examples: {
        good: [{ ...validExample('example_good_test'), note: 'extra' }],
        bad: [validExample('example_bad_test')],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects rule with empty scope array', () => {
    const result = StyleGuideConfigSchema.safeParse({
      ...validConfig,
      rules: [{ ...validRule('rule_test'), scope: [] }],
    });
    expect(result.success).toBe(false);
  });
});
