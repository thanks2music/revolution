import { z } from 'zod';

import { CATEGORY_SLUG_REGEX } from './category';
import { TITLE_SLUG_REGEX } from './title';
import { VENUE_SLUG_REGEX } from './venue';

/**
 * Schema-SDD 真実源: extraction step (`2-extraction.yaml`) の LLM 応答 top-level JSON。
 *
 * Sprint C-β P0 で新設。OpenAI Structured Outputs (json_schema strict mode) に渡すため、
 * 以下の strict 準拠制約を満たす:
 * - すべての `properties` を `required` 化 (`.optional()` 不使用、null 許容は `.nullable()`)
 * - `additionalProperties: false` は adapter 層 (`zod-to-openai-schema.ts`) で全 object に自動付与
 *
 * `2-extraction.yaml` の `output.schema` (L826-1079、Templates R4 最終 `70eeda4`) と 1:1 対応。
 * 未知フィールドが LLM 応答に混入するのを防ぐと同時に、`event_data` object を強制出力させる
 * (Sprint C-α で顕在化した「LLM が event_data 自体を省略する」失敗パターンの解消)。
 */

const MediaTypeEnum = z.enum([
  'anime',
  'anime_movie',
  'manga',
  'game',
  'vtuber',
  'youtuber',
  'idol',
  'utaite',
  'voice_actor',
  'vocaloid',
  'character',
  'movie',
  'drama',
  'tokusatsu',
  'other',
]);

const SourceTypeEnum = z.enum([
  'manga_based',
  'novel_based',
  'original_with_creator',
  'game_creator_based',
  'music_creator_based',
  'illustrator_based',
  'original_anime',
  'studio_production',
  'game_original',
  'character_brand',
  'vocaloid_character',
  'youtuber',
  'idol',
  'voice_actor',
  'tokusatsu',
  'other',
]);

const WorkEntrySchema = z.object({
  title: z.string(),
  is_primary: z.boolean(),
});

const StoreSchema = z.object({
  name: z.string(),
  multiple_locations: z.string().nullable(),
});

const EventPeriodSchema = z.object({
  開始: z.object({
    年: z.string(),
    日付: z.string(),
  }),
  終了: z.object({
    年: z.string().nullable(),
    日付: z.string().nullable(),
    未定: z.boolean(),
  }),
});

const MenuItemSchema = z.object({
  character: z.string().nullable(),
  name: z.string(),
  price: z.string(),
  imageUrl: z.string().nullable(),
  copyright: z.string().nullable(),
});

const StrictEventDataOccurrenceSchema = z.object({
  venue_slug: z.string().regex(VENUE_SLUG_REGEX).nullable(),
  venue_label: z.string().nullable(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date().nullable(),
  official_url: z.string().nullable(),
});

/**
 * `event_data` schema の strict-mode 変種。
 *
 * mdx-frontmatter.ts の `EventDataSchema` は `.optional()` を含み OpenAI strict mode 非対応
 * のため、Sprint C-β P0 では strict 変種を extraction-response 内でインライン定義する。
 * 相互互換: `EventDataSchema.safeParse(strict output)` は成功する (strict variant はより厳密)。
 */
const StrictEventDataSchema = z.object({
  primary_category_slug: z.string().regex(CATEGORY_SLUG_REGEX),
  title_slugs: z.array(z.string().regex(TITLE_SLUG_REGEX)),
  supplementary_category_slugs: z.array(z.string().regex(CATEGORY_SLUG_REGEX)).max(2),
  occurrences: z.array(StrictEventDataOccurrenceSchema),
});

const ReasoningSchema = z.object({
  works: z.string(),
  work_vs_store: z.string(),
  store: z.string(),
  開催期間: z.string(),
  メディアタイプ: z.string(),
  原作タイプ: z.string(),
  原作者名: z.string(),
  スタジオ名: z.string(),
  監督名: z.string(),
  シリーズ名: z.string(),
  開催都道府県: z.string(),
  メニュー詳細リスト: z.string(),
  メニューテーマ説明: z.string(),
  具体的なメニュー名リスト: z.string(),
  event_data_reason: z.string(),
});

export const ExtractionResponseSchema = z.object({
  works: z.array(WorkEntrySchema).min(1).max(4),
  store: StoreSchema,
  メディアタイプ: MediaTypeEnum,
  原作タイプ: SourceTypeEnum,
  原作者有無: z.boolean(),
  原作者名: z.array(z.string()).nullable(),
  スタジオ名: z.string().nullable(),
  監督名: z.string().nullable(),
  シリーズ名: z.string().nullable(),
  開催期間: EventPeriodSchema,
  公式サイトURL: z.string(),
  略称: z.string().nullable(),
  キャラクター名: z.array(z.string()).nullable(),
  テーマ名: z.string().nullable(),
  ノベルティ名: z.string().nullable(),
  ノベルティ種類数: z.string().nullable(),
  メニュー種類数: z.string().nullable(),
  グッズ名: z.array(z.string()).nullable(),
  メニュー詳細リスト: z.array(MenuItemSchema).nullable(),
  メニューテーマ説明: z.string().nullable(),
  具体的なメニュー名リスト: z.array(z.string()).nullable(),
  店舗の住所: z.string().nullable(),
  開催都道府県: z.array(z.string()).nullable(),
  コピーライト: z.string().nullable(),
  TwitterURL: z.string().nullable(),
  event_data: StrictEventDataSchema,
  _reasoning: ReasoningSchema,
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;
