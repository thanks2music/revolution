import { z } from 'zod';

/**
 * Schema-SDD 真実源: `ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml`
 * (revolution-templates master) の config schema。
 *
 * Sprint D 第 1 弾 Phase 1 で新設。コラボカフェ業界の標準語彙・テンプレ句を用途カテゴリ別に
 * SSoT 化し、LLM の独自言い換え (「フォトジェニック」→「映える」等) を抑制する
 * (style-guide.yaml の Rule `rule_industry_lexicon_preferred` が参照する辞書)。
 *
 * カテゴリは 5 つ固定 (BOSS 承認済、理想 doc §10.7)。`world_view` のみプレースホルダー含みの
 * テンプレ句 (`templates`) を持ち、他 4 カテゴリは語彙リスト (`terms`) を持つ。
 * record ではなくカテゴリ key ごとに shape を固定した object で表現し、カテゴリの増減・
 * shape 混同を compile-time + parse-time の両方で検知する。
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/shared/industry-lexicon.yaml
 * @see revolution-templates/CLAUDE.md §主要な設計パターン §6.3 (人間可読要約 + ポインタ)
 */

/**
 * 語彙リストを持つカテゴリ (menu_expressions / goods_expressions / visual_style / honorifics)。
 */
export const TermsCategorySchema = z
  .object({
    description: z.string().min(1, 'description must not be empty'),
    terms: z.array(z.string().min(1)).min(1, 'terms must not be empty'),
  })
  .strict();

/**
 * プレースホルダー含みテンプレ句を持つカテゴリ (world_view のみ)。
 * `.strict()` により `terms` 混入 (shape 混同) を parse-time で reject する。
 */
export const TemplatesCategorySchema = z
  .object({
    description: z.string().min(1, 'description must not be empty'),
    templates: z.array(z.string().min(1)).min(1, 'templates must not be empty'),
  })
  .strict();

/**
 * `industry-lexicon.yaml` 全体の schema。カテゴリ 5 つは必須 (欠落 = parse error)。
 */
export const IndustryLexiconConfigSchema = z
  .object({
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'version must be in semver format (e.g., "1.0.0")'),
    last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_updated must be in YYYY-MM-DD format'),
    categories: z
      .object({
        menu_expressions: TermsCategorySchema,
        goods_expressions: TermsCategorySchema,
        visual_style: TermsCategorySchema,
        world_view: TemplatesCategorySchema,
        honorifics: TermsCategorySchema,
      })
      .strict(),
  })
  .strict();

export type TermsCategory = z.infer<typeof TermsCategorySchema>;
export type TemplatesCategory = z.infer<typeof TemplatesCategorySchema>;
export type IndustryLexiconConfig = z.infer<typeof IndustryLexiconConfigSchema>;
export type IndustryLexiconCategory = TermsCategory | TemplatesCategory;

/**
 * カテゴリ key の canonical 契約 (BOSS 承認済 5 カテゴリ、理想 doc §10.7)。
 * カテゴリ追加時は本定数 + `IndustryLexiconConfigSchema.categories` + YAML を同時更新する。
 */
export const EXPECTED_CATEGORY_KEYS = [
  'menu_expressions',
  'goods_expressions',
  'visual_style',
  'world_view',
  'honorifics',
] as const;

export type IndustryLexiconCategoryKey = (typeof EXPECTED_CATEGORY_KEYS)[number];
