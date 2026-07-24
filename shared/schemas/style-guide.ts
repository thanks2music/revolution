import { z } from 'zod';

/**
 * Schema-SDD 真実源: `ai-writer/posts/yaml/collabo-cafe/shared/style-guide.yaml`
 * (revolution-templates master、sync:templates で派生コピーが
 * `apps/ai-writer/templates/posts/yaml/collabo-cafe/shared/` に配置される) の config schema。
 *
 * Sprint D 第 1 弾 Phase 1 で新設。「BOSS の理想 = 人 (従業員指導) スタイル ≠ AI が
 * 生成しやすいスタイル」の観点から、Revolution 用の「AI が無理なく生成できる文章スタイル」を
 * Rule (中程度粒度) + Few-shot 例 (good/bad) で SSoT 化する (理想 doc §2 中心軸
 * (a) 事実正確性 + (f) AI 生成しやすいスタイル 並立)。
 *
 * canonical: `revolution-templates/CLAUDE.md §主要な設計パターン §6.3` が人間可読要約 +
 * ポインタを持つ (Rule 全文は YAML のみが真実源、二重管理しない)。
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/shared/style-guide.yaml
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml
 *      (Rule `rule_industry_lexicon_preferred` が参照する語彙辞書)
 */

/**
 * Rule / Few-shot 例の適用スコープ。初期スコープはリード文 + 本文 H2 直下 Excerpt の 2 箇所
 * (Sprint D 第 1 弾の中核と一致)。Sprint 完了毎の記事デバッグセッションでの拡大時に enum 追加。
 */
export const StyleGuideScopeEnum = z.enum(['lead', 'body_h2_excerpt']);

/**
 * 中程度粒度の Rule 1 件。構造ルール + 抽象論のみを持ち、具体的制約は Few-shot 例に委譲する。
 */
export const StyleGuideRuleSchema = z.object({
  id: z
    .string()
    .regex(/^rule_[a-z0-9_]+$/, 'rule id must be snake_case with "rule_" prefix'),
  scope: z.array(StyleGuideScopeEnum).min(1, 'scope must not be empty'),
  statement: z.string().min(1, 'statement must not be empty'),
  reason: z.string().min(1, 'reason must not be empty'),
});

/**
 * Few-shot 例 1 件。good/bad の区別は `few_shot_examples.{good,bad}` の所属配列で表現する
 * (field で分けない)。`body` は実記事・実 dry-run から抽出した実文面のみを置く (捏造例文禁止)。
 */
export const StyleGuideFewShotExampleSchema = z.object({
  id: z
    .string()
    .regex(/^example_[a-z0-9_]+$/, 'example id must be snake_case with "example_" prefix'),
  scope: StyleGuideScopeEnum,
  source: z.string().min(1, 'source must not be empty'),
  body: z.string().min(1, 'body must not be empty'),
  why: z.string().min(1, 'why must not be empty'),
});

/**
 * `style-guide.yaml` 全体の schema。
 *
 * rules / few_shot_examples.{good,bad} の非空を強制する — BOSS が Sprint 完了毎に
 * Rule / 例を追記する運用で、誤って空にしてしまう regression を起動時に fail-loud で検知する。
 */
export const StyleGuideConfigSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'version must be in semver format (e.g., "1.0.0")'),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_updated must be in YYYY-MM-DD format'),
  rules: z.array(StyleGuideRuleSchema).min(1, 'at least one rule is required'),
  few_shot_examples: z.object({
    good: z
      .array(StyleGuideFewShotExampleSchema)
      .min(1, 'at least one good example is required'),
    bad: z
      .array(StyleGuideFewShotExampleSchema)
      .min(1, 'at least one bad example is required'),
  }),
});

export type StyleGuideScope = z.infer<typeof StyleGuideScopeEnum>;
export type StyleGuideRule = z.infer<typeof StyleGuideRuleSchema>;
export type StyleGuideFewShotExample = z.infer<typeof StyleGuideFewShotExampleSchema>;
export type StyleGuideConfig = z.infer<typeof StyleGuideConfigSchema>;

/**
 * 初期 Rule 4 件の canonical 契約 (Sprint D 第 1 弾 Phase 1、BOSS gate レビュー対象)。
 * BOSS が YAML に Rule を追記/削除したら本定数も同時更新する (§6.3 更新プロセス)。
 * drift は Layer 1 test が検知する。
 */
export const EXPECTED_RULE_IDS = [
  'rule_one_sentence_one_topic',
  'rule_industry_lexicon_preferred',
  'rule_redundancy_allowed',
  'rule_clear_information_placement',
] as const;

/**
 * 適用スコープの canonical 契約 (初期 2 箇所)。
 */
export const EXPECTED_SCOPE_VALUES: readonly StyleGuideScope[] = ['lead', 'body_h2_excerpt'];
