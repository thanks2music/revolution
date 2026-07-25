import { z } from 'zod';

import { MediaTypeEnum, SourceTypeEnum } from './extraction-response';

/**
 * Schema-SDD 真実源: `apps/ai-writer/config/media-type-mapping.yaml` の追加セクション
 * `original_type_labels` (§6.2 メディア形態表記マップの原作タイプ 16 種側) + 既存
 * `media_type_mappings.*.label` (§6.2 メディアタイプ 14 種 fallback 側) を統合した
 * config schema。
 *
 * Sprint C-β P11 で新設。`MediaFormResolverService.resolve(原作タイプ, メディアタイプ)` が
 * リード文 1 文目の [メディア形態] スロットに埋める日本語表記を決定するために使う。
 *
 * §6.2 対訳マップ (canonical: `revolution-templates/CLAUDE.md §主要な設計パターン §6.2`) に準拠。
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/shared/placeholders.yaml
 *      (メディア形態表記 派生変数の宣言)
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/sections/01-lead.yaml
 *      (リード文 4 スロット構造の [メディア形態] スロット消費者)
 */

/**
 * 原作タイプ (16 種) → 日本語表記のマッピング。
 *
 * §6.2 準拠。`studio_production` / `original_with_creator` / `other` はメディアタイプに依存する
 * 曖昧値であり、YAML では `null` (フォールバック指示) として宣言する。
 *
 * `MediaTypeEnum` / `SourceTypeEnum` は `extraction-response.ts` から re-use し、hand-maintained
 * TS union との drift を回避する (Sprint C-β P0 で確立した pattern)。
 */
export const OriginalTypeLabelSchema = z.record(SourceTypeEnum, z.string().nullable());

/**
 * メディアタイプ (14 種) → 日本語表記のマッピング。§6.2 準拠。
 */
export const MediaTypeLabelSchema = z.record(MediaTypeEnum, z.string());

/**
 * `media-type-mapping.yaml` の 1 つの `media_type_mappings.*` エントリ。
 * 既存フィールド (`label` / `character_separator` / `description` / `notes`) を保持しつつ、
 * §6.2 準拠の日本語 label を強制する。
 */
export const MediaTypeMappingEntrySchema = z.object({
  label: z.string().min(1, 'label must not be empty').max(20, 'label must be 20 characters or less'),
  character_separator: z
    .string()
    .min(1, 'character_separator must not be empty')
    .max(10, 'character_separator must be 10 characters or less'),
  description: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * `media-type-mapping.yaml` 全体の schema (Sprint C-β P11 拡張版)。
 *
 * 既存の `media_type_mappings` に加え、`original_type_labels` セクション (§6.2 原作タイプ 16 種 →
 * 日本語対訳) を必須化する。既存 config (Sprint C-β P11 前) との後方互換は移行時に破壊されるが、
 * `MediaFormResolverService` が本 schema に基づいてバリデーションするため、YAML 更新漏れは起動時に検知される。
 */
export const MediaFormMappingConfigSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'version must be in semver format (e.g., "1.0.0")'),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_updated must be in YYYY-MM-DD format'),
  media_type_mappings: z
    .record(MediaTypeEnum, MediaTypeMappingEntrySchema)
    .refine(
      (mappings) => Object.keys(mappings).length > 0,
      'At least one media type mapping is required'
    ),
  /**
   * Sprint C-β P11 追加: §6.2 原作タイプ 16 種 → 日本語表記マップ。
   * 曖昧値 (`studio_production` / `original_with_creator` / `other`) は `null` を明示宣言し、
   * `MediaFormResolverService` が `メディアタイプ` にフォールバックする。
   */
  original_type_labels: OriginalTypeLabelSchema,
  separator_rules: z
    .object({
      default: z.string(),
      idol_utaite: z.string(),
      reason: z.string(),
    })
    .optional(),
  author_name_rules: z
    .object({
      separator: z.string(),
      applies_to_media_types: z.boolean(),
      reason: z.string(),
    })
    .optional(),
});

export type MediaFormMappingConfig = z.infer<typeof MediaFormMappingConfigSchema>;
export type MediaTypeMappingEntry = z.infer<typeof MediaTypeMappingEntrySchema>;
export type OriginalTypeLabel = z.infer<typeof OriginalTypeLabelSchema>;

/**
 * §6.2 対訳マップの canonical 期待値 (test で shape validation に使用)。
 * `media-type-mapping.yaml` の値が更新されても本定数は canonical 契約として維持される。
 */
export const EXPECTED_ORIGINAL_TYPE_LABELS: Record<z.infer<typeof SourceTypeEnum>, string | null> = {
  manga_based: '漫画',
  novel_based: 'ライトノベル',
  original_with_creator: null, // メディアタイプにフォールバック
  game_creator_based: 'ゲーム',
  illustrator_based: 'イラスト',
  music_creator_based: '楽曲',
  original_anime: 'アニメ',
  studio_production: null, // メディアタイプにフォールバック (anime_movie → アニメ映画 / movie → 映画)
  game_original: 'ゲーム',
  character_brand: 'キャラクター',
  vocaloid_character: 'バーチャル・シンガー',
  youtuber: 'YouTuber',
  idol: 'アイドル',
  voice_actor: '声優',
  tokusatsu: '特撮',
  other: null, // メディアタイプにフォールバック
};

export const EXPECTED_MEDIA_TYPE_LABELS: Record<z.infer<typeof MediaTypeEnum>, string> = {
  anime: 'アニメ',
  anime_movie: 'アニメ映画',
  manga: '漫画',
  game: 'ゲーム',
  vtuber: 'VTuber',
  youtuber: 'YouTuber',
  idol: 'アイドル',
  utaite: '歌い手',
  voice_actor: '声優',
  vocaloid: 'バーチャル・シンガー',
  character: 'キャラクター',
  movie: '映画',
  drama: 'ドラマ',
  tokusatsu: '特撮',
  other: '作品',
};

/**
 * 両方 miss 時の最終フォールバック値 (§6.2 「両方 miss の場合: 「作品」で代用」準拠)。
 */
export const MEDIA_FORM_FALLBACK_LABEL = '作品';
