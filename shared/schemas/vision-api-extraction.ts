import { z } from 'zod';

/**
 * Schema-SDD 真実源: Vision API extraction result (Templates v1.2 SoT).
 *
 * Truth basis: `revolution-templates/ai-writer/posts/yaml/collabo-cafe/pipeline/
 * 1.5-vision-extraction.yaml` (commit `6d31c46`):
 *   - `output_schema.visionExtraction.{menuItems,goodsItems,noveltyItems}` shape
 *   - v1.2 で追加: `hasNovelty` / `noveltyCondition` (menu),
 *     `isRandomSale` (goods), `isRandom` (novelty), `confidence` (goods/novelty)
 *   - v1.2 で構造変更: `noveltyItem` (単一) → `noveltyItems[]` (配列)
 *
 * Revolution 側 `apps/ai-writer/lib/types/vision-api.ts` は本スキーマ由来の
 * `z.infer` 型を re-export する形に集約する (Sprint 3 PR-B / Schema-SDD Phase 3)。
 *
 * 注: `RawClaudeResponse` / `RawVisionResponse` (provider 側 raw 形) は本ファイルに
 * 含めない。各 service 実装の internal な変換境界として apps/ai-writer 配下に閉じる。
 * shared/schemas は **typed の最終戻り値の契約** のみを保持する (SoC: 境界スキーマ集約)。
 */

export const MenuItemSchema = z.object({
  /** Menu item name (as written in the image). */
  name: z.string(),
  /** Tax-included price preferred. */
  price: z.number().optional(),
  /** Character names. Empty array (not null) when no characters. */
  characterName: z.array(z.string()),
  /** Whether this menu item has an attached novelty/bonus. (Templates v1.2) */
  hasNovelty: z.boolean(),
  /** Distribution condition for the attached novelty. (Templates v1.2) */
  noveltyCondition: z.string().optional(),
  /**
   * @deprecated Use `hasNovelty` + `noveltyCondition` (Templates v1.2 alignment).
   * Retained for backward compatibility with pre-v1.2 prompt outputs.
   */
  bonus: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  remarks: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const GoodsItemSchema = z.object({
  name: z.string(),
  price: z.number().optional(),
  variantCount: z.number().optional(),
  variantDetails: z.string().optional(),
  /** Character names. Empty array (not null) when no characters. */
  characterName: z.array(z.string()),
  /** Whether this goods item is sold via random/blind-bag distribution. (Templates v1.2) */
  isRandomSale: z.boolean(),
  /** Per-item extraction confidence. (Templates v1.2) */
  confidence: z.number().min(0).max(1).optional(),
});

export const NoveltyItemSchema = z.object({
  name: z.string(),
  condition: z.string().optional(),
  variantCount: z.number().optional(),
  /** Character names. Empty array (not null) when no characters. */
  characterName: z.array(z.string()),
  /** Whether this novelty is distributed randomly (vs. selectable). (Templates v1.2) */
  isRandom: z.boolean(),
  /** Per-item extraction confidence. (Templates v1.2) */
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
  remarks: z.string().optional(),
});

export const TokensUsedSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const VisionExtractionMetadataSchema = z.object({
  hasComingSoonNotice: z.boolean().optional(),
  totalImagesAnalyzed: z.number().int().nonnegative().optional(),
  tokensUsed: TokensUsedSchema.optional(),
});

export const VisionExtractionResultSchema = z.object({
  visionExtraction: z.object({
    confidence: z.number().min(0).max(1),
    provider: z.enum(['openai', 'claude']),
    timestamp: z.string(),
    menuItems: z.array(MenuItemSchema),
    goodsItems: z.array(GoodsItemSchema),
    noveltyItems: z.array(NoveltyItemSchema),
    metadata: VisionExtractionMetadataSchema.optional(),
  }),
});

export type MenuItem = z.infer<typeof MenuItemSchema>;
export type GoodsItem = z.infer<typeof GoodsItemSchema>;
export type NoveltyItem = z.infer<typeof NoveltyItemSchema>;
export type TokensUsed = z.infer<typeof TokensUsedSchema>;
export type VisionExtractionMetadata = z.infer<typeof VisionExtractionMetadataSchema>;
export type VisionExtractionResult = z.infer<typeof VisionExtractionResultSchema>;
