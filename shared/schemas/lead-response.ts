import { z } from 'zod';

/**
 * Schema-SDD 真実源: `LeadGeneratorService.generate()` の戻り値。
 *
 * Sprint C-β P11 で新設。リード文を LLM 生成から切り出し、TypeScript 側で 4 スロット構造
 * (`[主体]+[接続動詞]+[形容詞]+[メディア形態]+「作品名」`) を rule-driven に組み立てる際の
 * 戻り値契約を定義する (Layer 1 test で slot 構造 regression を assert)。
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/sections/01-lead.yaml
 *      (テンプレート辞書、4 スロット metadata 定義)
 * @see revolution-templates/docs/plan/2026-07-13-ai-writer-ideal-article-vision.md §1
 *      (N1 リード文パイプライン化の設計)
 */

/**
 * 4 スロット構造 (§vision doc §1 準拠)。
 *
 * リード文 1 文目の主体・接続動詞・形容詞・メディア形態・作品名を分離して保持し、
 * regression test で slot の欠落を検出する。
 *
 * - agent: 「PEACH-PIT先生」「新海誠監督と京都アニメーション」「サンリオ」など (null = 主体省略)
 * - verb: 「による」「が手掛ける」「監督と/制作で贈る」など (null = 接続動詞省略)
 * - adjective: 「人気」「大人気」「世界中で愛される」など (null = デフォルト「人気」)
 * - mediaForm: §6.2 対訳マップ準拠の日本語表記 (「漫画」「アニメ映画」「キャラクター」等、必須)
 * - workTitle: primary_work.title (必須)
 */
export const LeadSlotsSchema = z.object({
  agent: z.string().nullable(),
  verb: z.string().nullable(),
  adjective: z.string().nullable(),
  mediaForm: z.string().min(1, 'mediaForm must not be empty'),
  workTitle: z.string().min(1, 'workTitle must not be empty'),
});

/**
 * `LeadGeneratorService.generate()` の戻り値。
 */
export const LeadGeneratorResultSchema = z.object({
  /**
   * 生成された MDX リード文 (2 段落想定、1 文目 = 4 スロット構造 + 2 文目 = メニュー概要)。
   * `4-content.yaml` 生成出力の先頭に concat される。
   */
  leadMdx: z.string().min(1, 'leadMdx must not be empty'),
  /**
   * どのテンプレート id を使ったか (デバッグ / regression 用)。
   * 例: `lead_author_with_characters` / `lead_multi_work_anime_x_character` / `lead_generic`
   * LLM Fallback 発火時は `__fallback__` を返す。
   */
  usedTemplate: z.string().min(1, 'usedTemplate must not be empty'),
  /**
   * LLM Fallback 発火時の理由 (未発火時は undefined)。
   * 例: `all_conditions_missed` / `too_many_unreplaced_placeholders` / `output_too_short`
   */
  fallbackReason: z.string().optional(),
  /**
   * 4 スロット構造 (regression assertion 用)。
   */
  slots: LeadSlotsSchema,
});

export type LeadSlots = z.infer<typeof LeadSlotsSchema>;
export type LeadGeneratorResult = z.infer<typeof LeadGeneratorResultSchema>;

/**
 * LLM Fallback 発火時に `usedTemplate` に入る sentinel 文字列。
 */
export const LEAD_FALLBACK_TEMPLATE_ID = '__fallback__' as const;

/**
 * `fallbackReason` の enum (LLM Fallback 発火条件の観測性向上)。
 * Sprint C-β P10 (observability) で structured log/metric に promote する際の label として使う。
 */
export const LeadFallbackReasonEnum = z.enum([
  'all_conditions_missed',
  'too_many_unreplaced_placeholders',
  'output_too_short',
  'output_empty',
  'template_render_error',
  'empty_work_title', // Sprint C-β P11 R1: works[] 空 + 作品名 未指定で workTitle='' となるケースの early guard
]);

export type LeadFallbackReason = z.infer<typeof LeadFallbackReasonEnum>;
