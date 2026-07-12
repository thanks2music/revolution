/**
 * EventFactCard mapping helpers
 *
 * @description
 * MVP §11 (Sprint C-α) の EventFactCard 4 フィールド (`event_start_date` /
 * `event_end_date` / `venue` / `official_url`) を、AI Writer extraction 結果から
 * frontmatter 契約向けに派生させる deterministic mapping ロジック。
 *
 * ## 優先順位 (Q4=C、BOSS 承認 2026-07-12)
 * 1. `event_data.occurrences[0]` (プロンプト応答の開催ブロック雛形、Sprint C-α で新設)
 * 2. `detailedExtraction.開催期間` / `店舗名` / `公式サイトURL` (既存 extraction、後方互換)
 *
 * ## 不正日付ハンドリング (Codex Approved 2026-07-12)
 * `MdxFrontmatterSchema` の `event_start_date` / `event_end_date` は Zod
 * `z.iso.date()` で `YYYY-MM-DD` 厳密検証。ここで `undefined` に落とすことで
 * schema 違反値を下流に流さない (silent drop、observability は orchestrator 側で確保)。
 *
 * ## Sprint C-α スコープ
 * - Sprint C-α プラン Step 1b で導入 (Layer 1 helper、regression 検知基盤)
 * - Step 5.5 で `article-generation-mdx.service.ts` から呼び出し
 * - Codex 双方向レビュー threadId `019f53af-065c-7bb1-85df-28ad907a0fd4` 経由で設計確定
 *
 * @see /Users/yoshi/.claude/plans/url-compiled-wigderson.md § 発見 4
 * @see MdxFrontmatterSchema (`@revolution/schemas/mdx-frontmatter`)
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// 入力型定義
// -----------------------------------------------------------------------------

/**
 * `detailedExtraction.開催期間.開始` / `終了.` に対応する部分型。
 * 日本語日付形式 (`年: "YYYY年"` / `日付: "N月NN日"`) を受け取る。
 */
export interface JapaneseDatePart {
  年: string | null;
  日付: string | null;
}

/**
 * `event_data.occurrences[0]` (Sprint C-α で AI Writer プロンプト応答に新設される
 * 開催ブロック雛形、`primary_category_slug` / `title_slugs[]` / `supplementary_category_slugs[]` /
 * `occurrences[]` の一部) に対応する型。
 */
export interface EventDataOccurrence {
  venue_slug: string | null;
  venue_label: string | null;
  starts_on: string; // ISO 8601 date (YYYY-MM-DD)、プロンプト側で厳密検証済想定
  ends_on: string | null;
  official_url: string | null;
}

/**
 * `extractEventFactCardFields` の入力形状。
 *
 * @description
 * 呼び出し側 (`article-generation-mdx.service.ts` の mdx-assembly step 直前) から
 * 必要最小限のフィールドだけ抽出して渡す。orchestrator 本体を重く import せずに
 * Layer 1 test 可能な粒度を維持する。
 */
export interface ExtractEventFactCardFieldsInput {
  /**
   * Sprint C-α で新設される開催ブロック雛形。プロンプト応答の
   * `event_data.occurrences` (配列)。未定義または空配列の場合は fallback に落ちる。
   */
  eventDataOccurrences?: EventDataOccurrence[];

  /**
   * `detailedExtraction.開催期間` の後方互換 fallback。event_data 不在時に使用。
   */
  extractionPeriod?: {
    開始?: JapaneseDatePart;
    終了?: JapaneseDatePart & { 未定?: boolean };
  } | null;

  /**
   * `detailedExtraction.店舗名` の後方互換 fallback (venue)。
   */
  extractionStoreName?: string | null;

  /**
   * `selectionResult.primary_official_url` の後方互換 fallback (official_url)。
   * article-selection step の結果、公式サイト URL が検出できた場合の値。
   */
  extractionOfficialUrl?: string | null;
}

// -----------------------------------------------------------------------------
// 出力型定義
// -----------------------------------------------------------------------------

/**
 * `MdxFrontmatterSchema` の EventFactCard 用 optional 4 フィールドと同一形状。
 * schema.parse 適合を Layer 1 で保証するため、helper 側で厳密検証済の値のみ返す。
 */
export interface EventFactCardFields {
  event_start_date?: string; // YYYY-MM-DD、`z.iso.date()` 適合済
  event_end_date?: string;   // YYYY-MM-DD、`z.iso.date()` 適合済
  venue?: string;            // 空文字は返さない
  official_url?: string;     // 無効 URL は返さない
}

// -----------------------------------------------------------------------------
// Schema-SDD 整合性: helper 出力の validation
// -----------------------------------------------------------------------------

/**
 * `z.iso.date()` と同等の厳密検証。`YYYY-MM-DD` かつ実在する日付のみ通す。
 *
 * @description
 * `2026-02-30` / `2026-13-01` / `2026-1-1` (桁不足) / 全角数字 / 空文字 / 半角空白は
 * すべて拒否 (`false`)。Zod 公式仕様 `z.iso.date()` と一貫させる。
 *
 * @see https://zod.dev/api?id=iso-dates
 */
const ISO_DATE_SCHEMA = z.iso.date();

function isValidIsoDate(value: string): boolean {
  return ISO_DATE_SCHEMA.safeParse(value).success;
}

/**
 * URL の厳密検証 (`MdxFrontmatterSchema.official_url` の `z.string().url()` 適合)。
 */
const URL_SCHEMA = z.string().url();

function isValidUrl(value: string): boolean {
  return URL_SCHEMA.safeParse(value).success;
}

/**
 * 空白のみ or 空文字を空扱いする helper。
 * (Sprint A/B/C precedent: U+3000 全角空白も含めて `.trim()` で吸収)
 */
function isBlank(value: string | null | undefined): boolean {
  if (value == null) return true;
  return value.trim().length === 0;
}

// -----------------------------------------------------------------------------
// 日本語日付 → ISO 8601 date 変換
// -----------------------------------------------------------------------------

/**
 * `{ 年: "2026年", 日付: "7月12日" }` → `"2026-07-12"` に変換。
 *
 * ## 不正入力の扱い (Codex Approved 2026-07-12)
 * 以下のケースは `undefined` を返す (schema 違反値を下流に流さない):
 * - `null` / `undefined` 入力
 * - `年` or `日付` が `null` / 空白
 * - `年` が `YYYY年` パターン非適合 (`2026`、`R7年` 等)
 * - `日付` が `N月NN日` パターン非適合 (`12/25`、`7月`、`日付未定` 等)
 * - 実在しない日付 (`2026-02-30`、`2026-13-01`)
 * - `z.iso.date()` safeParse 失敗
 *
 * @example
 * toIsoDate({ 年: "2026年", 日付: "7月12日" })    // → "2026-07-12"
 * toIsoDate({ 年: "2025年", 日付: "12月19日" })   // → "2025-12-19"
 * toIsoDate({ 年: null, 日付: "7月12日" })         // → undefined
 * toIsoDate({ 年: "2026年", 日付: "2月30日" })    // → undefined (schema 拒否)
 * toIsoDate(undefined)                              // → undefined
 */
export function toIsoDate(part: JapaneseDatePart | null | undefined): string | undefined {
  if (part == null) return undefined;
  if (part.年 == null || part.日付 == null) return undefined;
  if (isBlank(part.年) || isBlank(part.日付)) return undefined;

  // 年: `YYYY年` 厳密パターン (半角数字 4 桁 + "年")
  const yearMatch = part.年.match(/^(\d{4})年$/);
  if (!yearMatch) return undefined;
  const year = yearMatch[1];

  // 日付: `N月NN日` パターン (半角数字 1-2 桁 + "月" + 半角数字 1-2 桁 + "日")
  const dateMatch = part.日付.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (!dateMatch) return undefined;
  const month = dateMatch[1].padStart(2, '0');
  const day = dateMatch[2].padStart(2, '0');

  const isoDate = `${year}-${month}-${day}`;

  // `z.iso.date()` safeParse で存在しない日付 (2026-02-30 等) を拒否
  if (!isValidIsoDate(isoDate)) return undefined;

  return isoDate;
}

// -----------------------------------------------------------------------------
// メインエントリポイント: extractEventFactCardFields
// -----------------------------------------------------------------------------

/**
 * AI Writer extraction 結果から EventFactCard 4 フィールドを派生させる (Q4=C)。
 *
 * ## 優先順位 (BOSS 承認 2026-07-12、Codex Approved threadId `019f53af...`)
 * 1. `event_data.occurrences[0]` (Sprint C-α で新設される開催ブロック雛形)
 * 2. `extractionPeriod` / `extractionStoreName` / `extractionOfficialUrl` (既存 extraction)
 *
 * ## 各フィールドの派生ルール
 *
 * ### `event_start_date`
 * - primary: `occurrences[0].starts_on` (すでに YYYY-MM-DD、schema 検証)
 * - fallback: `toIsoDate(extractionPeriod.開始)` (日本語日付 → YYYY-MM-DD 変換)
 * - どちらも無効なら `undefined`
 *
 * ### `event_end_date`
 * - primary: `occurrences[0].ends_on` (nullable、null なら fallback)
 * - fallback: `toIsoDate(extractionPeriod.終了)` (ただし `終了.未定 === true` なら `undefined`)
 * - どちらも無効なら `undefined`
 *
 * ### `venue`
 * - primary: `occurrences[0].venue_label` (nullable、null なら fallback)
 * - fallback: `extractionStoreName` (空白/null 除外)
 *
 * ### `official_url`
 * - primary: `occurrences[0].official_url` (nullable、null なら fallback)
 * - fallback: `extractionOfficialUrl` (`z.string().url()` 適合のみ)
 *
 * @example
 * // Case 1: event_data 優先
 * extractEventFactCardFields({
 *   eventDataOccurrences: [{ venue_slug: "box-cafe", venue_label: "BOX cafe&space",
 *     starts_on: "2026-05-14", ends_on: "2026-07-05", official_url: "https://example.com" }],
 *   extractionPeriod: { 開始: { 年: "2026年", 日付: "5月14日" } },
 *   extractionStoreName: "別の店舗名",
 * })
 * // → { event_start_date: "2026-05-14", event_end_date: "2026-07-05",
 * //     venue: "BOX cafe&space", official_url: "https://example.com" }
 *
 * // Case 2: fallback (event_data 不在)
 * extractEventFactCardFields({
 *   extractionPeriod: { 開始: { 年: "2026年", 日付: "5月14日" },
 *     終了: { 年: "2026年", 日付: "7月5日", 未定: false } },
 *   extractionStoreName: "テスト店舗",
 *   extractionOfficialUrl: "https://example.com",
 * })
 * // → { event_start_date: "2026-05-14", event_end_date: "2026-07-05",
 * //     venue: "テスト店舗", official_url: "https://example.com" }
 */
export function extractEventFactCardFields(
  input: ExtractEventFactCardFieldsInput
): EventFactCardFields {
  const primary = input.eventDataOccurrences?.[0];

  // -----------------------
  // event_start_date
  // -----------------------
  let eventStartDate: string | undefined;
  if (primary?.starts_on && isValidIsoDate(primary.starts_on)) {
    eventStartDate = primary.starts_on;
  } else {
    eventStartDate = toIsoDate(input.extractionPeriod?.開始);
  }

  // -----------------------
  // event_end_date
  // -----------------------
  let eventEndDate: string | undefined;
  if (primary?.ends_on && isValidIsoDate(primary.ends_on)) {
    eventEndDate = primary.ends_on;
  } else if (input.extractionPeriod?.終了?.未定 === true) {
    // 終了日未定は明示的に undefined (fallback パスでも undefined)
    eventEndDate = undefined;
  } else {
    eventEndDate = toIsoDate(input.extractionPeriod?.終了);
  }

  // -----------------------
  // venue
  // -----------------------
  let venue: string | undefined;
  if (primary?.venue_label && !isBlank(primary.venue_label)) {
    venue = primary.venue_label.trim();
  } else if (input.extractionStoreName && !isBlank(input.extractionStoreName)) {
    venue = input.extractionStoreName.trim();
  }

  // -----------------------
  // official_url
  // -----------------------
  let officialUrl: string | undefined;
  if (primary?.official_url && isValidUrl(primary.official_url)) {
    officialUrl = primary.official_url;
  } else if (input.extractionOfficialUrl && isValidUrl(input.extractionOfficialUrl)) {
    officialUrl = input.extractionOfficialUrl;
  }

  // undefined フィールドは含めずに返す (MdxFrontmatterSchema は optional 前提)
  const result: EventFactCardFields = {};
  if (eventStartDate !== undefined) result.event_start_date = eventStartDate;
  if (eventEndDate !== undefined) result.event_end_date = eventEndDate;
  if (venue !== undefined) result.venue = venue;
  if (officialUrl !== undefined) result.official_url = officialUrl;

  return result;
}
