/**
 * stripUtmFromUrl (Layer 1 純粋関数) の単体テスト
 *
 * Sprint C-β P14: UTM 除去純関数の契約検証。
 * development-principles.md「層別 TDD」の Layer 1 MUST 原則に基づく。
 */

import { describe, it, expect } from '@jest/globals';
import { stripUtmFromUrl } from '../../../../lib/utils/url';

describe('stripUtmFromUrl', () => {
  describe('utm パラメータの除去', () => {
    it('collabo-cafe.com 4 種 utm (source/medium/campaign/id) を完全除去する', () => {
      const input =
        'https://www.medicos-e.net/newsdetail/d-gray-man/?utm_source=collabo_cafe_dot_com&utm_medium=collabo_cafe_dot_com&utm_campaign=collabo_cafe_dot_com&utm_id=collabo_cafe_dot_com';
      expect(stripUtmFromUrl(input)).toBe(
        'https://www.medicos-e.net/newsdetail/d-gray-man/'
      );
    });

    it('utm_source 単独でも除去する', () => {
      expect(
        stripUtmFromUrl('https://example.com/page?utm_source=xxx')
      ).toBe('https://example.com/page');
    });

    it('Google Analytics 6 種 (source/medium/campaign/content/term/id) すべて除去する', () => {
      const input =
        'https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e&utm_id=f';
      expect(stripUtmFromUrl(input)).toBe('https://example.com/');
    });
  });

  describe('utm 以外のパラメータは保持', () => {
    it('utm 混在時、他パラメータ (ref) を保持しつつ utm のみ除去する', () => {
      const input =
        'https://example.com/page?utm_source=x&ref=abc&utm_medium=y';
      expect(stripUtmFromUrl(input)).toBe(
        'https://example.com/page?ref=abc'
      );
    });

    it('複数の非 utm パラメータの順序を保持する', () => {
      const input =
        'https://example.com/page?page=1&sig=xyz&utm_source=x&sort=asc';
      // URLSearchParams は元順を保持するが utm 削除で挿入間の gap を詰める
      expect(stripUtmFromUrl(input)).toBe(
        'https://example.com/page?page=1&sig=xyz&sort=asc'
      );
    });
  });

  describe('副次的挙動', () => {
    it('query string なし URL は変更なし (idempotent)', () => {
      const url = 'https://example.com/page';
      expect(stripUtmFromUrl(url)).toBe(url);
    });

    it('既に clean な URL に再適用しても同じ結果 (idempotent)', () => {
      const cleaned =
        'https://www.medicos-e.net/newsdetail/d-gray-man/';
      expect(stripUtmFromUrl(cleaned)).toBe(cleaned);
      // 二度適用しても no-op
      expect(stripUtmFromUrl(stripUtmFromUrl(cleaned))).toBe(cleaned);
    });

    it('fragment (#section) は utm 除去後も保持される', () => {
      expect(
        stripUtmFromUrl('https://example.com/page?utm_source=x#hero')
      ).toBe('https://example.com/page#hero');
    });

    it('相対 URL は無変更で返す (URL parse fallback)', () => {
      const url = '/relative/path?utm_source=x';
      expect(stripUtmFromUrl(url)).toBe(url);
    });

    it('大文字 UTM_* も除去する (case-insensitive)', () => {
      const input = 'https://example.com/?UTM_SOURCE=x&Utm_Medium=y';
      expect(stripUtmFromUrl(input)).toBe('https://example.com/');
    });
  });

  describe('null/undefined 安全性', () => {
    it('undefined は空文字を返す', () => {
      expect(stripUtmFromUrl(undefined)).toBe('');
    });

    it('null は空文字を返す', () => {
      expect(stripUtmFromUrl(null)).toBe('');
    });

    it('空文字は空文字を返す', () => {
      expect(stripUtmFromUrl('')).toBe('');
    });
  });
});
