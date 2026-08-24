import { describe, expect, it } from '@jest/globals';

import { countTracks } from '@/e2e/grid-tracks';

/**
 * `countTracks` (Layer 1 = 決定的な純粋関数) の分岐網羅。
 *
 * Playwright 本体は staging の dev サーバを要求するため CI で動かせないが、
 * **パース部分だけはここで CI に載る** (claude-review / Codex の指摘、2026-08-25)。
 *
 * ⚠️ 本テストの主眼は「正しく数えられること」より **未対応の形を通さないこと**。
 *    空白の数で推測すると、宣言列数と偶然一致して**誤った合格**を出すため。
 */
describe('countTracks', () => {
  it('列指定が無い (none) は 1 カラムとして扱う', () => {
    // `display: grid` だけでレスポンシブ分岐が当たっていない状態。
    // クラス名の綴り間違いもここに落ちる。
    expect(countTracks('none')).toBe(1);
    expect(countTracks('  none  ')).toBe(1);
  });

  it('固定回数の repeat() は回数をそのまま返す', () => {
    // Chrome が Tailwind の grid-cols-N に対して返す実測の形。
    expect(countTracks('repeat(2, minmax(0px, 1fr))')).toBe(2);
    expect(countTracks('repeat(3, minmax(0px, 1fr))')).toBe(3);
    expect(countTracks('repeat(1, minmax(0px, 1fr))')).toBe(1);
  });

  it('解決済みのピクセル一覧はトラック数を数える', () => {
    expect(countTracks('1050px')).toBe(1);
    expect(countTracks('295.328px 295.328px 295.328px')).toBe(3);
  });

  describe('未対応の形は例外にする (fail-closed)', () => {
    // 以下はいずれも「空白の数」で数えると誤った値になり、
    // 宣言列数と偶然一致して**テストが通ってしまう**入力。
    it.each([
      // 空白 2 個だがトラックは 1 本。data-grid-layout="row" (2 列) と誤って一致する
      ['行名つき', '[start] 1fr'],
      // 先頭の repeat だけ見ると 2 だが、実際は 3 本
      ['repeat と固定トラックの併用', 'repeat(2, 1fr) 100px'],
      // 回数が数値でないため列数が静的に決まらない
      ['auto-fill', 'repeat(auto-fill, minmax(0px, 1fr))'],
      ['auto-fit', 'repeat(auto-fit, minmax(120px, 1fr))'],
      // greedy な `.*` が先頭の repeat だけを見て 2 を返していた (正しくは 5)
      ['repeat の連結', 'repeat(2, 1fr) repeat(3, 1fr)'],
      ['subgrid', 'subgrid'],
      ['fr 単位の解決済み一覧', '1fr 1fr'],
    ])('%s', (_label, template) => {
      expect(() => countTracks(template)).toThrow(/未対応の grid-template-columns/);
    });
  });
});
