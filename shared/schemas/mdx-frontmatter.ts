import { z } from 'zod';

import { CATEGORY_SLUG_REGEX } from './category';
import { EVENT_SLUG_REGEX } from './event';
import { TITLE_SLUG_REGEX } from './title';
import { VENUE_SLUG_REGEX } from './venue';

/**
 * Schema-SDD 真実源: MDX frontmatter 構造
 *
 * Truth basis: 過去 11 件の "Generate MDX" PR から抽出した実 frontmatter
 * SoC 境界: 構造はパブリック (本ファイル)、slug の真実値は revolution-templates の YAML
 *
 * 注: `date` は ISO 8601 ms (datetime({ precision: 3, offset: true })) 限定の forward-looking
 * 契約。リポジトリ内 sample-work/01kafsdmvd.mdx の plain YYYY-MM-DD は別タスクで再生成予定で、
 * 移行完了までは本スキーマで parse 失敗するのが想定動作。
 */

// -----------------------------------------------------------------------------
// EventData (Sprint C-α で新設、「開催ブロック雛形」)
// -----------------------------------------------------------------------------

/**
 * `event_data.occurrences[]` の 1 要素 schema。**1 要素 = 1 開催 (会場 × 期間)**。
 *
 * @description
 * AI Writer プロンプト応答の開催ブロック雛形 (Templates 側 `2-extraction.yaml` の
 * output.schema.properties.event_data.occurrences[] と整合)。
 *
 * ★ **会場が N 個なら要素も N 個**。DB の `public.occurrences` が 1 event : N occurrences
 *   設計 (migration `0013`) であるのと 1:1 で対応する。
 *
 *   2026-08-07 まで本 docstring は「MVP は通常 1 要素、Sprint D で複数開催対応
 *   (Release: Random Access Memories)」と書いていたが、**そのフェーズは 2026-08-02 に
 *   撤廃済み**で、作業がどの計画にも継承されていなかった。実測すると 5 会場のイベントでも
 *   1 要素に集約され、`venue_label` が「A、B、C」と連結された 1 文字列になっていた
 *   (集約を命じていたのは `2-extraction.yaml` のプロンプト指示)。
 *
 *   同一会場の前期/後期のように**同じ会場が 2 期間**あるケースも、要素を 2 つ持つことで
 *   表現する (`venue_label` の重複は正当)。
 *
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/pipeline/2-extraction.yaml (Sprint C-α Step 1c)
 * @see apps/ai-writer/lib/utils/event-fact-card-mapper.ts (Q4=C deterministic mapping、Sprint C-α Step 1b)
 * @see shared/schemas/db/occurrences.ts (取り込み先の DB schema)
 */
export const EventDataOccurrenceSchema = z.object({
  /** venues master 登録済の場合の canonical slug (venue_aliases 実装 = S3 まで通常 null) */
  venue_slug: z.string().regex(VENUE_SLUG_REGEX).nullable(),
  /** その会場の正式名称 (支店名込み)。**複数会場を「、」で連結してはならない** */
  venue_label: z.string().min(1).nullable(),
  /**
   * 開催開始日 (YYYY-MM-DD、`開催期間.開始.年 + 日付` から導出)。
   *
   * ★ **nullable** (2026-08-09、BOSS 確定)。日付が未発表の段階の記事が存在するため
   *   (`mvp-definition.md` A-1-c パターン 1/2 = 第一報のみ / 場所のみ判明)。
   *   A-1-c は「A-4 の取り込みパイプラインは日付欠落を**欠陥ではなく正常な状態**として
   *   upsert できる必要がある」と定めているのに、以前は必須にしていたため矛盾していた。
   *
   *   必須のままだと LLM は読めない日付でも何かを埋めるしかなく、実測で
   *   `2025-01-01 〜 2025-12-31` という 1 年間まるごとの捏造が出ていた。
   *   **捏造させるより null で「不明」と表明させる**。
   */
  starts_on: z.iso.date().nullable(),
  /** 開催終了日 (YYYY-MM-DD)、`開催期間.終了.未定 === true` なら null */
  ends_on: z.iso.date().nullable(),
  /** 公式サイトURL */
  official_url: z.string().url().nullable(),
});

/**
 * `event_data` schema (Sprint C-α で新設、BOSS 承認 Q5=A)。
 *
 * @description
 * AI Writer 記事 JSON に含まれる機械可読の「開催ブロック」。**DB upsert の本実装は
 * S3 (occurrence 半自動パイプライン = 運用開始ゲート A-4)**。本 schema はその入力契約。
 *
 * ## フィールド
 * - `event_name` / `event_slug`: 企画そのもの (→ `events.name` / `events.slug`)。★2026-08-09 追加
 * - `primary_category_slug`: `events.primary_category` 相当 = URL 正準決定 (23 categories seed enum)
 * - `title_slugs[]`: コラボ複数 title 対応 (event_titles M:N)、`is_primary: true` を配列先頭
 * - `supplementary_category_slugs[]`: 混在イベント補助タグ (event_categories M:N)、maxItems: 2 (Q5=A)
 * - `occurrences[]`: 開催情報配列。**会場が N 個なら N 要素**
 *
 * ## 参照ソース
 * - `CATEGORY_SLUG_REGEX` (`./category`): 23 seed slugs の URL 正準検証 (Sprint A PR #247)
 * - `TITLE_SLUG_REGEX` (`./title`): title-romaji-mapping.yaml と整合 (Sprint A PR #249)
 * - `VENUE_SLUG_REGEX` (`./venue`): venues master (空 seed、Sprint A PR #251) と整合
 *
 * @see /Users/yoshi/.claude/plans/url-compiled-wigderson.md § Q5=A
 * @see revolution-templates/ai-writer/config/slug-registry.yaml (23 categories canonical、Sprint C-α Step 1a)
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/pipeline/2-extraction.yaml (プロンプト output schema、Sprint C-α Step 1c)
 */
export const EventDataSchema = z.object({
  /**
   * 公式の企画名をそのまま (→ `events.name`)。
   *
   * ★ 2026-08-09 追加。**2026-08-03 に BOSS が確定していた** (`revolution-article-meta.md` §2.1)
   *   にもかかわらず実装されていなかった分。
   *
   * `event_title` (下の `MdxFrontmatterSchema`) とは別物。あちらは名前に反して
   * 「コラボカフェ」等のカテゴリ名が入っているため、同階層に置くと衝突する。
   *
   * ★ 既存記事との互換のため `.optional()`。生成側は必ず出力する。
   */
  event_name: z.string().min(1).optional(),
  /**
   * `event_name` を slug 化したもの (→ `events.slug`)。
   *
   * **`events` upsert の自然キー**であり、canonicalKey (`{eventSlug}:{eventType}:{year}`)
   * の中核。決定③で `event_id` 書き戻しを廃止した代わりに、frontend がビルド時に
   * これで join する。**URL には出さない**。
   *
   * ★ 種別を機械的に付与してはならない (`{作品}-cafe` 等)。公式名称の改変になり、
   *   テイクアウトのみの企画に `-cafe` を付けると「席がないのにカフェと名乗る」ことになる。
   *   種別は `event_type` が独立に持つ (`revolution-article-meta.md` §4.3)。
   */
  event_slug: z.string().regex(EVENT_SLUG_REGEX).optional(),
  primary_category_slug: z.string().regex(CATEGORY_SLUG_REGEX),
  title_slugs: z.array(z.string().regex(TITLE_SLUG_REGEX)),
  supplementary_category_slugs: z.array(z.string().regex(CATEGORY_SLUG_REGEX)).max(2).optional(),
  occurrences: z.array(EventDataOccurrenceSchema).optional(),
});

/** `EventDataSchema` の TypeScript 型推論 */
export type EventData = z.infer<typeof EventDataSchema>;

/** `EventDataOccurrenceSchema` の TypeScript 型推論 */
export type EventDataOccurrence = z.infer<typeof EventDataOccurrenceSchema>;

// -----------------------------------------------------------------------------
// MdxFrontmatterSchema (既存 + Sprint C-α で `event_data` 追加)
// -----------------------------------------------------------------------------

export const MdxFrontmatterSchema = z.object({
  post_id: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  event_type: z.string().min(1),
  event_title: z.string().min(1),
  work_title: z.string().min(1),
  work_slug: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  date: z.string().datetime({ precision: 3, offset: true }),
  categories: z.array(z.string().min(1)),
  excerpt: z.string().min(1),
  author: z.string().min(1),
  // nullable + 非 optional: generator は frontmatter.ogImage が空なら null を出力するため
  // (apps/ai-writer/scripts/generate-article-index.ts:271)、key の欠落 (undefined) は受け付けない
  ogImage: z.string().nullable(),

  // 配列要素も .min(1) 強制: 空文字 tag/slug は不正データ扱い (categories と同等)
  tags: z.array(z.string().min(1)).optional(),
  work_titles: z.array(z.string().min(1)).optional(),
  prefectures: z.array(z.string().min(1)).optional(),
  prefecture_slugs: z.array(z.string().min(1)).optional(),
  // ベンダー名で統一 (`AiProviderType` と同値)。旧値 'gemini' は 2026-08-11 に
  // 'google' へリネーム済み — 移行時点の実記事は全て 'openai' で永続値ゼロのため
  // 後方互換は持たせていない。
  ai_provider: z.enum(['anthropic', 'google', 'openai']).optional(),
  ai_model: z.string().optional(),

  // Legacy: 過去 MDX 互換のため optional として温存 (現行 generator は prefectures/prefecture_slugs を使用)
  venues: z.array(z.string().min(1)).optional(),
  venue_slugs: z.array(z.string().min(1)).optional(),

  // EventFactCard 黄色「あと N 日」バッジ点灯のための optional フィールド群。
  // event_start_date / event_end_date は parseLocalDate で JST ローカル日付として
  // 解釈されるため、ISO 8601 date (YYYY-MM-DD) を厳密に要求する (`date` フィールドの
  // ISO 8601 ms 制約とは別系統)。`z.iso.date()` (zod v4) は単純 regex と異なり、
  // 月 (01-12) と日 (該当月の最大日) のレンジ違反 (例: 2026-13-45, 2026-02-30) も拒否する。
  // 値が揃うと EventFactCard が status='coming-soon' / 'now' / 'ended' に切り替わる。
  event_start_date: z.iso.date().optional(),
  event_end_date: z.iso.date().optional(),
  venue: z.string().min(1).optional(),
  official_url: z.string().url().optional(),

  // Sprint C-α で新設: 開催ブロック event_data (BOSS 承認 α、2026-07-12)
  // - AI Writer プロンプトが `event_data.occurrences[]` として応答 (会場が N 個なら N 要素)
  // - MDX frontmatter に nested YAML として serialize (Step 5.4、template-generator.ts)
  // - EventFactCard 4 フィールド (event_start_date / event_end_date / venue / official_url) は
  //   `event_data.occurrences[0]` を優先ソースとする deterministic mapping で導出 (Q4=C、Step 5.5)。
  //   [0] を採るのは FactCard が代表 1 会場しか表示しない UI 契約のためで、
  //   `occurrences` 自体は N 件のまま frontmatter へ serialize される
  // - DB upsert 本実装は **S3 (occurrence 半自動パイプライン = A-4)**
  event_data: EventDataSchema.optional(),
});

export type MdxFrontmatter = z.infer<typeof MdxFrontmatterSchema>;
