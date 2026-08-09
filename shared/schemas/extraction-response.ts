import { z } from 'zod';

import { CATEGORY_SLUG_REGEX } from './category';
import { EVENT_SLUG_REGEX } from './event';
import { EventDataOccurrenceSchema } from './mdx-frontmatter';
import { TITLE_SLUG_REGEX } from './title';

/**
 * Schema-SDD 真実源: extraction step (`2-extraction.yaml`) の LLM 応答 top-level JSON。
 *
 * OpenAI Structured Outputs (json_schema strict mode) に渡すため、以下の strict 準拠制約を満たす:
 * - すべての `properties` を `required` 化 (`.optional()` 不使用、null 許容は `.nullable()`)
 * - `additionalProperties: false` は adapter 層 (`zod-to-openai-schema.ts`) で全 object に自動付与
 *
 * `2-extraction.yaml` の `output.schema` と 1:1 対応。未知フィールドが LLM 応答に混入するのを防ぐ
 * と同時に、strict mode の `additionalProperties: false` を通じて `event_data` object を強制出力
 * させる。
 */

/**
 * メディアタイプ enum。`MediaType` type は `z.infer<typeof MediaTypeEnum>` で derive し、
 * hand-maintained TS union との drift を回避する (追加/削除は本ファイルのみで完結)。
 */
export const MediaTypeEnum = z.enum([
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

/**
 * 原作タイプ enum。`SourceType` type は `z.infer<typeof SourceTypeEnum>` で derive し、
 * hand-maintained TS union との drift を回避する。
 */
export const SourceTypeEnum = z.enum([
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
  /**
   * 英語タイトル (slug 生成用、`WorkEntry` interface 経由で slug-generation service が使用)。
   * strict mode ではオブジェクトから未宣言 property が silent drop されるため、safeParse 経由でも
   * 保持されるよう schema に明示。`.nullable()` で LLM が省略できる契約。
   */
  title_en: z.string().nullable(),
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

/**
 * `event_data` schema の strict-mode 変種。
 *
 * mdx-frontmatter.ts の `EventDataSchema` は outer level で `supplementary_category_slugs` /
 * `occurrences` に `.optional()` を持ち OpenAI strict mode 非対応のため、outer level のみ
 * strict 変種をインライン定義。inner `EventDataOccurrenceSchema` は既に strict-mode 適合
 * (全 field required, `.nullable()` 併用) のため mdx-frontmatter から直接 import して drift を
 * 回避。`EventDataSchema.safeParse(strict output)` は相互互換で成功する。
 */
const StrictEventDataSchema = z.object({
  // ★ strict mode は全 field required。`event_data` は生成側が必ず出すため required でよい
  //   (frontmatter 読み取り側の `EventDataSchema` は既存記事互換で optional にしている)。
  event_name: z.string().min(1),
  event_slug: z.string().regex(EVENT_SLUG_REGEX),
  primary_category_slug: z.string().regex(CATEGORY_SLUG_REGEX),
  title_slugs: z.array(z.string().regex(TITLE_SLUG_REGEX)),
  supplementary_category_slugs: z.array(z.string().regex(CATEGORY_SLUG_REGEX)).max(2),
  occurrences: z.array(EventDataOccurrenceSchema),
});

/**
 * `_reasoning` schema。全 field を `.nullable()` にすることで、VTuber / character-brand /
 * idol などの「該当なし」が正当なイベントで LLM が hallucinated filler ('該当なし' / '不明' 等)
 * を強制されないようにする。strict mode で全 required にすると schema-conform pressure で
 * false reasoning が混入する回帰を回避。
 */
export const ReasoningSchema = z.object({
  works: z.string().nullable(),
  work_vs_store: z.string().nullable(),
  store: z.string().nullable(),
  開催期間: z.string().nullable(),
  メディアタイプ: z.string().nullable(),
  原作タイプ: z.string().nullable(),
  原作者名: z.string().nullable(),
  スタジオ名: z.string().nullable(),
  監督名: z.string().nullable(),
  シリーズ名: z.string().nullable(),
  開催都道府県: z.string().nullable(),
  メニュー詳細リスト: z.string().nullable(),
  メニューテーマ説明: z.string().nullable(),
  具体的なメニュー名リスト: z.string().nullable(),
  event_data_reason: z.string().nullable(),
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
  /**
   * 開催回数 (「第N弾」形式、v2.3.0)。downstream `article-generation-mdx.extractedEventNumber`
   * + title-generation quality score が参照するため、YAML `extraction_fields` にあり
   * `output.schema` に未追加だった穴を Zod 側で明示 declare する。
   */
  開催回数: z.string().nullable(),
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

/** Zod SoT から derive、hand-maintained TS union / interface との drift を排除。 */
export type MediaType = z.infer<typeof MediaTypeEnum>;
export type SourceType = z.infer<typeof SourceTypeEnum>;
export type ExtractionReasoning = z.infer<typeof ReasoningSchema>;
