import { describe, expect, it } from '@jest/globals';

import { normalizeAlias } from '@/lib/ingest/normalize-alias';

/**
 * naming doc §4-4 の 5 段正規化。fixture は実データ由来:
 * - 全角混じりの venue_label は 2026-08-15 実走の記事 9 本に実在する
 *   (`BOX cafe&space ＫＩＴＴＥ OSAKA １号店`)
 * - 括弧の補足・& のゆれは brand-slugs.yaml / naming doc §5 の実例
 */
describe('normalizeAlias', () => {
  it.each([
    // [入力, 期待値]
    ['BOX cafe&space ＫＩＴＴＥ OSAKA １号店', 'boxcafeandspacekitteosaka1号店'],
    ['BOX cafe&space KITTE OSAKA 1号店', 'boxcafeandspacekitteosaka1号店'],
    ['BOX CAFE & SPACE KITTE OSAKA 1号店', 'boxcafeandspacekitteosaka1号店'],
  ])('全角・空白・&・大小のゆれが同一キーに寄る: %s', (input, expected) => {
    expect(normalizeAlias(input)).toBe(expected);
  });

  it('NFKC で全角英数を半角へ寄せる', () => {
    expect(normalizeAlias('ＯＰＡ')).toBe('opa');
  });

  it('空白 (半角・全角・連続) を全除去する', () => {
    expect(normalizeAlias('スイーツパラダイス 池袋店')).toBe(
      normalizeAlias('スイーツパラダイス池袋店'),
    );
    expect(normalizeAlias('スイーツパラダイス　池袋店')).toBe(
      normalizeAlias('スイーツパラダイス池袋店'),
    );
  });

  it('括弧内の補足を除去する (半角・全角どちらの括弧でも)', () => {
    expect(normalizeAlias('SMILE BASE CAFE (スマイルベースカフェ)')).toBe('smilebasecafe');
    expect(normalizeAlias('eeo Cafe（旧: GraffArt CAFE）')).toBe('eeocafe');
  });

  it('& を and に統一する', () => {
    expect(normalizeAlias('BOX CAFE & SPACE')).toBe(normalizeAlias('BOX cafe&space'));
  });

  it('正規化で空になる入力は空文字を返す', () => {
    expect(normalizeAlias('  ')).toBe('');
    expect(normalizeAlias('(補足のみ)')).toBe('');
  });

  it('ASCII slug はそのまま通る (title_slugs のゆれ照合用)', () => {
    expect(normalizeAlias('meitantei-conan')).toBe('meitantei-conan');
  });
});
