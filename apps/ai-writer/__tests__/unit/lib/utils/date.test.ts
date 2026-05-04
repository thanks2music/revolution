/**
 * toIsoMsDate (Layer 1 純粋関数) の単体テスト
 *
 * Schema-SDD 契約 (`MdxFrontmatterSchema.date = datetime({ precision: 3, offset: true })`)
 * への適合を担保。development-principles.md「層別 TDD」の Layer 1 MUST 原則に基づく。
 */

import { describe, it, expect } from '@jest/globals';
import { toIsoMsDate } from '../../../../lib/utils/date';

describe('toIsoMsDate', () => {
  const ISO_8601_MS_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/;

  describe('valid input', () => {
    it('plain YYYY-MM-DD を ISO 8601 ms に正規化する', () => {
      expect(toIsoMsDate('2025-11-20')).toBe('2025-11-20T00:00:00.000Z');
    });

    it('RFC 2822 形式 (RSS pubDate 標準) を ISO 8601 ms に正規化する', () => {
      // Wed, 21 Oct 2015 07:28:00 GMT
      expect(toIsoMsDate('Wed, 21 Oct 2015 07:28:00 GMT')).toBe(
        '2015-10-21T07:28:00.000Z'
      );
    });

    it('ISO 8601 ms 入力をそのまま返す (idempotent)', () => {
      const input = '2026-05-04T01:59:14.830Z';
      expect(toIsoMsDate(input)).toBe(input);
    });

    it('ISO 8601 (ms なし) を ms 付きに正規化する', () => {
      expect(toIsoMsDate('2026-05-04T12:00:00Z')).toBe('2026-05-04T12:00:00.000Z');
    });
  });

  describe('invalid input fallback', () => {
    it('undefined → 現在時刻 (ISO 8601 ms)', () => {
      const result = toIsoMsDate(undefined);
      expect(result).toMatch(ISO_8601_MS_REGEX);
    });

    it('null → 現在時刻 (ISO 8601 ms)', () => {
      const result = toIsoMsDate(null);
      expect(result).toMatch(ISO_8601_MS_REGEX);
    });

    it('空文字 → 現在時刻 (ISO 8601 ms)', () => {
      const result = toIsoMsDate('');
      expect(result).toMatch(ISO_8601_MS_REGEX);
    });

    // claude review CL1 由来: ' ' は truthy で new Date(' ') が Invalid Date を返し
    // .toISOString() が RangeError を throw するため、isNaN ガードが必要
    it('whitespace のみ → 現在時刻 (Invalid Date を回避し throw しない)', () => {
      const result = toIsoMsDate(' ');
      expect(result).toMatch(ISO_8601_MS_REGEX);
    });

    it('完全な garbage 文字列 → 現在時刻 (Invalid Date を回避し throw しない)', () => {
      const result = toIsoMsDate('not-a-date');
      expect(result).toMatch(ISO_8601_MS_REGEX);
    });
  });

  describe('Schema-SDD 契約適合', () => {
    it('全ての出力が ISO_8601_MS_REGEX に match する', () => {
      const inputs = [
        '2025-11-20',
        'Wed, 21 Oct 2015 07:28:00 GMT',
        '2026-05-04T01:59:14.830Z',
        undefined,
        '',
        ' ',
        'garbage',
      ];

      for (const input of inputs) {
        expect(toIsoMsDate(input)).toMatch(ISO_8601_MS_REGEX);
      }
    });
  });
});
