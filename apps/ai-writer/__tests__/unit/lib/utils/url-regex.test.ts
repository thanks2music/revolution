/**
 * Layer 1 pure function test — Sprint C-β P14 claude[bot] R2 review 対応
 *
 * `URL_REGEX` (`lib/utils/url-regex.ts`) の境界文字扱いを検証する。
 * 日本語 prose 中の全角句読点隣接 URL で「句読点が URL match に吸い込まれて後段の
 * `stripUtmFromUrl` 経由で prose corruption (句読点消失) する」回帰の防止が目的。
 * 既存 ASCII 境界文字扱いの regression 保証も併せて担う。
 */

import { describe, it, expect } from '@jest/globals';
import { URL_REGEX } from '../../../../lib/utils/url-regex';

// character class の regression / progression を確認する pure regex test のため、
// 各テストの直前で lastIndex をリセットして stateful match の副作用を排除する
// (URL_REGEX は `g` flag 付き)。
function matchAll(input: string): string[] | null {
  URL_REGEX.lastIndex = 0;
  return input.match(URL_REGEX);
}

describe('URL_REGEX (lib/utils/url-regex)', () => {
  describe('ASCII 境界 (既存挙動の regression 保証)', () => {
    it('should stop at whitespace', () => {
      expect(matchAll('本文中に https://example.com/foo 続き')).toEqual([
        'https://example.com/foo',
      ]);
    });

    it.each([
      ['double quote', '"https://example.com/a"', 'https://example.com/a'],
      ['single quote', "'https://example.com/b'", 'https://example.com/b'],
      ['backtick', '`https://example.com/c`', 'https://example.com/c'],
      ['paren', '(https://example.com/d)', 'https://example.com/d'],
      ['angle bracket', '<https://example.com/e>', 'https://example.com/e'],
      ['square bracket', '[https://example.com/f]', 'https://example.com/f'],
    ])('should stop at ASCII %s', (_label, input, expected) => {
      expect(matchAll(input)).toEqual([expected]);
    });
  });

  describe('日本語 prose 中の全角句読点隣接 (Sprint C-β P14 R2 regression fix)', () => {
    it.each([
      ['、 (読点)', '本文中の URL は https://example.com/foo、次の文です。', 'https://example.com/foo'],
      ['。 (句点)', 'URL は https://example.com/bar。以上。', 'https://example.com/bar'],
      ['」 (右鉤括弧)', '「https://example.com/quoted」の中身', 'https://example.com/quoted'],
      ['』 (右二重鉤括弧)', '『https://example.com/dbquoted』の中身', 'https://example.com/dbquoted'],
      ['〕 (右亀甲括弧)', '〔https://example.com/kikko〕注記', 'https://example.com/kikko'],
      ['〉 (右角括弧)', '〈https://example.com/angle〉補足', 'https://example.com/angle'],
      ['》 (右二重角括弧)', '《https://example.com/dbangle》補足', 'https://example.com/dbangle'],
      ['】 (右隅付き括弧)', '【https://example.com/sumitsuki】重要', 'https://example.com/sumitsuki'],
    ])('should stop at full-width punctuation %s', (_label, input, expected) => {
      expect(matchAll(input)).toEqual([expected]);
    });
  });

  describe('UTM 付き URL + 全角句読点 (prose corruption 防止の bug scenario)', () => {
    it('should exclude trailing full-width punctuation from UTM-tagged URL match', () => {
      // Fix 前は match が「https://example.com/?utm_source=collabo_cafe_dot_com。」となり、
      // 後段の `stripUtmFromUrl` で URLSearchParams パース後の再構築時に句読点が消失していた。
      // Fix 後は URL 部分と句読点が正しく分離されるため、prose の「。」が保持される。
      expect(matchAll('公式サイトは https://example.com/?utm_source=collabo_cafe_dot_com。次の文です。')).toEqual([
        'https://example.com/?utm_source=collabo_cafe_dot_com',
      ]);
    });
  });
});
