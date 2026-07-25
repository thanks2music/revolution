/**
 * event-fact-card-mapper Layer 1 test
 *
 * @description
 * Sprint C-α (MVP §11 AI Writer プロンプト強化 + EventFactCard 統合) の
 * regression 検知基盤。Q4=C の deterministic mapping パターンを Layer 1 で徹底検証。
 *
 * ## Codex Approved 必須ケース (2026-07-12、threadId 019f53af-065c-7bb1-85df-28ad907a0fd4)
 * - `occurrences[0]` 優先 (全 5 フィールド: starts_on / ends_on / venue_label / venue_slug (未使用) / official_url)
 * - `extractionPeriod` fallback (event_data 不在時)
 * - `終了.未定 === true` → `event_end_date = undefined`
 * - `venue` fallback (`occurrences[0].venue_label` → `extractionStoreName`)
 * - `official_url` fallback (`occurrences[0].official_url` → `extractionOfficialUrl`)
 * - 不正日付 (`2026-02-30`, `2026-13-01`, 全角数字, 空文字, 片方 null) → `undefined`
 * - `z.iso.date().safeParse()` 整合 (helper 出力が下流 schema と互換)
 *
 * @see /Users/yoshi/.claude/plans/url-compiled-wigderson.md § 発見 4
 * @see apps/ai-writer/lib/utils/event-fact-card-mapper.ts
 */

import { describe, it, expect } from '@jest/globals';
import {
  extractEventFactCardFields,
  toIsoDate,
  type ExtractEventFactCardFieldsInput,
} from '../../../../lib/utils/event-fact-card-mapper';
import { MdxFrontmatterSchema } from '@revolution/schemas/mdx-frontmatter';

// -----------------------------------------------------------------------------
// toIsoDate: 日本語日付 → ISO 8601 date (YYYY-MM-DD)
// -----------------------------------------------------------------------------

describe('toIsoDate', () => {
  describe('正常系', () => {
    it('should convert "2026年" + "7月12日" to "2026-07-12" (桁埋め)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '7月12日' })).toBe('2026-07-12');
    });

    it('should convert "2025年" + "12月19日" to "2025-12-19"', () => {
      expect(toIsoDate({ 年: '2025年', 日付: '12月19日' })).toBe('2025-12-19');
    });

    it('should handle single-digit day (1月5日 → 01-05)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '1月5日' })).toBe('2026-01-05');
    });

    it('should handle 年またぎ (終了年 = 開始年 + 1 の 2026年4月)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '4月19日' })).toBe('2026-04-19');
    });
  });

  describe('不正入力: undefined 返却 (schema 違反値を下流に流さない)', () => {
    it('should return undefined for null input', () => {
      expect(toIsoDate(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(toIsoDate(undefined)).toBeUndefined();
    });

    it('should return undefined when 年 is null', () => {
      expect(toIsoDate({ 年: null, 日付: '7月12日' })).toBeUndefined();
    });

    it('should return undefined when 日付 is null', () => {
      expect(toIsoDate({ 年: '2026年', 日付: null })).toBeUndefined();
    });

    it('should return undefined when 年 is empty string', () => {
      expect(toIsoDate({ 年: '', 日付: '7月12日' })).toBeUndefined();
    });

    it('should return undefined when 日付 is blank (半角空白)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '   ' })).toBeUndefined();
    });

    it('should return undefined for invalid 年 pattern "2026" (missing 年 suffix)', () => {
      expect(toIsoDate({ 年: '2026', 日付: '7月12日' })).toBeUndefined();
    });

    it('should return undefined for invalid 年 pattern "R7年" (和暦)', () => {
      expect(toIsoDate({ 年: 'R7年', 日付: '7月12日' })).toBeUndefined();
    });

    it('should return undefined for invalid 日付 pattern "12/25"', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '12/25' })).toBeUndefined();
    });

    it('should return undefined for incomplete 日付 "7月"', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '7月' })).toBeUndefined();
    });

    it('should return undefined for non-numeric 日付 "日付未定"', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '日付未定' })).toBeUndefined();
    });

    it('should return undefined for non-existent date 2026-02-30 (z.iso.date() 拒否)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '2月30日' })).toBeUndefined();
    });

    it('should return undefined for non-existent month 2026-13-01 (z.iso.date() 拒否)', () => {
      expect(toIsoDate({ 年: '2026年', 日付: '13月1日' })).toBeUndefined();
    });

    it('should return undefined for full-width digits (全角数字)', () => {
      expect(toIsoDate({ 年: '２０２６年', 日付: '7月12日' })).toBeUndefined();
    });
  });
});

// -----------------------------------------------------------------------------
// extractEventFactCardFields: メインエントリポイント (Q4=C)
// -----------------------------------------------------------------------------

describe('extractEventFactCardFields', () => {
  describe('Case A: event_data.occurrences[0] 優先ソース (Q4=C primary path)', () => {
    it('should prioritize occurrences[0] for all 4 fields when event_data present', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: 'box-cafe-ikebukuro',
            venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店',
            starts_on: '2026-05-14',
            ends_on: '2026-07-05',
            official_url: 'https://example.com/event',
          },
        ],
        // 以下はすべて fallback だが event_data が優先されるので使われない
        extractionPeriod: {
          開始: { 年: '2999年', 日付: '1月1日' },
          終了: { 年: '2999年', 日付: '12月31日', 未定: false },
        },
        extractionStoreName: '別の店舗名 (fallback、使われない)',
        extractionOfficialUrl: 'https://fallback.example.com',
      };

      const result = extractEventFactCardFields(input);

      expect(result).toEqual({
        event_start_date: '2026-05-14',
        event_end_date: '2026-07-05',
        venue: 'BOX cafe&space マツモトキヨシ池袋Part2店',
        official_url: 'https://example.com/event',
      });
    });

    it('should handle occurrences[0] with null optional fields (venue_label/ends_on/official_url null → fallback)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null, // fallback to extractionStoreName
            starts_on: '2026-05-14',
            ends_on: null, // fallback to extractionPeriod.終了
            official_url: null, // fallback to extractionOfficialUrl
          },
        ],
        extractionPeriod: {
          終了: { 年: '2026年', 日付: '7月5日', 未定: false },
        },
        extractionStoreName: 'テスト店舗',
        extractionOfficialUrl: 'https://example.com/event',
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBe('2026-07-05');
      expect(result.venue).toBe('テスト店舗');
      expect(result.official_url).toBe('https://example.com/event');
    });

    it('should use only occurrences[0] even if occurrences[] has multiple entries (representative selection)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: 'primary',
            venue_label: 'Primary 会場',
            starts_on: '2026-05-14',
            ends_on: '2026-07-05',
            official_url: 'https://primary.example.com',
          },
          {
            venue_slug: 'secondary',
            venue_label: 'Secondary 会場 (使われない)',
            starts_on: '2026-08-01',
            ends_on: '2026-09-30',
            official_url: 'https://secondary.example.com',
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.venue).toBe('Primary 会場');
      expect(result.event_start_date).toBe('2026-05-14');
      // secondary 会場のデータは含まれない
      expect(result.venue).not.toContain('Secondary');
    });

    it('should reject invalid ISO date in occurrences[0].starts_on and fallback to extractionPeriod', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-02-30', // 無効日付 (z.iso.date() 拒否)
            ends_on: null,
            official_url: null,
          },
        ],
        extractionPeriod: {
          開始: { 年: '2026年', 日付: '5月14日' },
        },
      };

      const result = extractEventFactCardFields(input);

      // 無効な occurrences[0].starts_on を無視して fallback に落ちる
      expect(result.event_start_date).toBe('2026-05-14');
    });
  });

  describe('Case B: extractionPeriod / extractionStoreName / extractionOfficialUrl fallback path (event_data 不在)', () => {
    it('should fallback to extractionPeriod when event_data is undefined', () => {
      const input: ExtractEventFactCardFieldsInput = {
        // eventDataOccurrences 未指定
        extractionPeriod: {
          開始: { 年: '2026年', 日付: '5月14日' },
          終了: { 年: '2026年', 日付: '7月5日', 未定: false },
        },
        extractionStoreName: 'テスト店舗',
        extractionOfficialUrl: 'https://example.com/event',
      };

      const result = extractEventFactCardFields(input);

      expect(result).toEqual({
        event_start_date: '2026-05-14',
        event_end_date: '2026-07-05',
        venue: 'テスト店舗',
        official_url: 'https://example.com/event',
      });
    });

    it('should fallback to extractionPeriod when eventDataOccurrences is empty array', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [], // 空配列 → fallback
        extractionPeriod: {
          開始: { 年: '2026年', 日付: '5月14日' },
        },
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
    });
  });

  describe('Case C: 終了.未定 === true → event_end_date = undefined', () => {
    it('should return undefined for event_end_date when 終了.未定 === true', () => {
      const input: ExtractEventFactCardFieldsInput = {
        extractionPeriod: {
          開始: { 年: '2026年', 日付: '5月14日' },
          終了: { 年: null, 日付: null, 未定: true },
        },
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBeUndefined();
    });

    it('should ignore extractionPeriod.終了 when event_data provides ends_on', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14',
            ends_on: '2026-07-05',
            official_url: null,
          },
        ],
        extractionPeriod: {
          終了: { 年: null, 日付: null, 未定: true }, // 未定だが occurrences[0].ends_on が優先
        },
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_end_date).toBe('2026-07-05');
    });
  });

  describe('Case D: venue fallback + validation', () => {
    it('should trim whitespace from extractionStoreName fallback', () => {
      const input: ExtractEventFactCardFieldsInput = {
        extractionStoreName: '  テスト店舗  ',
      };

      const result = extractEventFactCardFields(input);

      expect(result.venue).toBe('テスト店舗');
    });

    it('should return undefined for venue when both sources are blank', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: '   ', // 空白のみ
            starts_on: '2026-05-14',
            ends_on: null,
            official_url: null,
          },
        ],
        extractionStoreName: '',
      };

      const result = extractEventFactCardFields(input);

      expect(result.venue).toBeUndefined();
    });
  });

  describe('Case E: official_url validation (z.string().url() 適合)', () => {
    it('should reject invalid URL in occurrences[0].official_url and fallback', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14',
            ends_on: null,
            official_url: 'not-a-url', // 無効
          },
        ],
        extractionOfficialUrl: 'https://valid.example.com',
      };

      const result = extractEventFactCardFields(input);

      expect(result.official_url).toBe('https://valid.example.com');
    });

    it('should return undefined for official_url when both sources are invalid', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14',
            ends_on: null,
            official_url: 'not-a-url',
          },
        ],
        extractionOfficialUrl: 'also-invalid',
      };

      const result = extractEventFactCardFields(input);

      expect(result.official_url).toBeUndefined();
    });
  });

  describe('Case F0: cross-field date-order guard (Codex 2026-07-12 review 高指摘 #2)', () => {
    // 背景: event_start_date と event_end_date が異なるソース (primary vs fallback) から
    // 独立に解決される可能性 → 逆順 (end < start) になり得る。EventFactCard の status
    // 計算 (coming-soon/now/ended) が silent nonsensical になるため helper で drop する。

    it('should drop event_end_date when end < start (primary starts + fallback ends 混在)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14', // primary から取得 (未来)
            ends_on: null, // primary は null → fallback へ
            official_url: null,
          },
        ],
        extractionPeriod: {
          終了: { 年: '2026年', 日付: '1月1日', 未定: false }, // fallback は 2026-01-01 (start より過去)
        },
      };

      const result = extractEventFactCardFields(input);

      // event_start_date は残る、event_end_date は逆順のため drop
      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBeUndefined();
    });

    it('should drop event_end_date when both from primary but inverted (defensive)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14',
            ends_on: '2026-04-01', // primary で逆順 (LLM 応答異常ケース)
            official_url: null,
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBeUndefined();
    });

    it('should keep both when end === start (同日イベント allowed)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2026-05-14',
            ends_on: '2026-05-14', // 同日開始・終了
            official_url: null,
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBe('2026-05-14');
    });

    it('should keep both when end > start (normal case, 年またぎ含む)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: null,
            starts_on: '2025-12-19',
            ends_on: '2026-04-19', // 年またぎ
            official_url: null,
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2025-12-19');
      expect(result.event_end_date).toBe('2026-04-19');
    });

    it('should not affect other fields (venue / official_url) when dropping event_end_date', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: null,
            venue_label: 'テスト会場',
            starts_on: '2026-05-14',
            ends_on: '2026-04-01', // 逆順
            official_url: 'https://example.com',
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.event_start_date).toBe('2026-05-14');
      expect(result.event_end_date).toBeUndefined();
      expect(result.venue).toBe('テスト会場');
      expect(result.official_url).toBe('https://example.com');
    });
  });

  describe('Case F: 全フィールド undefined (extraction 完全不在)', () => {
    it('should return empty object when no data provided (all undefined)', () => {
      const result = extractEventFactCardFields({});

      expect(result).toEqual({});
      expect(result.event_start_date).toBeUndefined();
      expect(result.event_end_date).toBeUndefined();
      expect(result.venue).toBeUndefined();
      expect(result.official_url).toBeUndefined();
    });
  });

  describe('Case G: MdxFrontmatterSchema 整合性 (Schema-SDD contract)', () => {
    it('should produce fields that pass MdxFrontmatterSchema.safeParse (Layer 1 でも下流 schema 契約を保証)', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: 'box-cafe',
            venue_label: 'BOX cafe&space',
            starts_on: '2026-05-14',
            ends_on: '2026-07-05',
            official_url: 'https://example.com/event',
          },
        ],
      };

      const helperResult = extractEventFactCardFields(input);

      // MdxFrontmatterSchema の必須フィールドを埋めた minimal frontmatter を組み立て
      const frontmatterCandidate = {
        post_id: 'test-post-id',
        year: 2026,
        event_type: 'collabo-cafe',
        event_title: 'コラボカフェ',
        work_title: 'テスト作品',
        work_slug: 'test-work',
        slug: 'test-post-id',
        title: 'テスト作品 × テスト店舗 5月14日よりコラボカフェ開催',
        date: '2026-07-12T00:00:00.000Z',
        categories: ['テスト作品', 'コラボカフェ'],
        excerpt: 'テスト用の抜粋文です。',
        author: 'thanks2music',
        ogImage: null,
        // helper 出力を frontmatter 契約にマージ
        ...helperResult,
      };

      const parseResult = MdxFrontmatterSchema.safeParse(frontmatterCandidate);

      // 詳細エラー出力 (fail 時のデバッグ用)
      if (!parseResult.success) {
        // eslint-disable-next-line no-console
        console.error(
          'MdxFrontmatterSchema parse failed:',
          JSON.stringify(parseResult.error.format(), null, 2)
        );
      }

      expect(parseResult.success).toBe(true);
    });

    it('should produce fields that pass schema even when all EventFactCard fields are undefined (optional)', () => {
      const helperResult = extractEventFactCardFields({});

      const frontmatterCandidate = {
        post_id: 'test-post-id',
        year: 2026,
        event_type: 'collabo-cafe',
        event_title: 'コラボカフェ',
        work_title: 'テスト作品',
        work_slug: 'test-work',
        slug: 'test-post-id',
        title: 'テスト作品 × テスト店舗 コラボカフェ開催',
        date: '2026-07-12T00:00:00.000Z',
        categories: ['テスト作品', 'コラボカフェ'],
        excerpt: 'テスト用の抜粋文です。',
        author: 'thanks2music',
        ogImage: null,
        // helper 出力は空オブジェクト、EventFactCard フィールドは含まれない
        ...helperResult,
      };

      const parseResult = MdxFrontmatterSchema.safeParse(frontmatterCandidate);

      expect(parseResult.success).toBe(true);
    });
  });

  describe('Case H: Sprint C-β P14 utm sanitization (collabo-cafe.com origin defense)', () => {
    it('should strip utm parameters from occurrences[0].official_url', () => {
      const input: ExtractEventFactCardFieldsInput = {
        eventDataOccurrences: [
          {
            venue_slug: 'kyara-um-cafe-ikebukuro',
            venue_label: 'キャラウムカフェ',
            starts_on: '2026-07-15',
            ends_on: '2026-10-18',
            official_url:
              'https://www.medicos-e.net/newsdetail/d-gray-man/?utm_source=collabo_cafe_dot_com&utm_medium=collabo_cafe_dot_com&utm_campaign=collabo_cafe_dot_com&utm_id=collabo_cafe_dot_com',
          },
        ],
      };

      const result = extractEventFactCardFields(input);

      expect(result.official_url).toBe(
        'https://www.medicos-e.net/newsdetail/d-gray-man/'
      );
    });

    it('should strip utm parameters from extractionOfficialUrl fallback', () => {
      const input: ExtractEventFactCardFieldsInput = {
        extractionOfficialUrl:
          'https://example.com/event?utm_source=collabo_cafe_dot_com&ref=preserved',
      };

      const result = extractEventFactCardFields(input);

      // utm 除去済み、非 utm パラメータ (ref) は保持
      expect(result.official_url).toBe('https://example.com/event?ref=preserved');
    });
  });
});
