import { describe, expect, it } from '@jest/globals';

import { isTabActive } from '@/components/organisms/BottomTabBar';

/**
 * 下部タブの現在地判定 (Layer 1、純粋関数)。
 *
 * ロジックをコンポーネントから切り出してあるのは、**静かに壊れる種類の分岐**
 * だから (2026-08-22 claude[bot] / `/code-review` の両方が指摘):
 *
 * - 「トップで『探す』を点灯させる」は v5 #1 由来の特殊対応で、消しても
 *   ビルドもテストも落ちず、`aria-current` が無くなるだけで気づきにくい
 * - 素の `startsWith` は将来 `/articles-archive` のような別ルートを
 *   誤って点灯させ得る
 */

describe('isTabActive', () => {
  const EXPLORE = ['/', '/titles', '/events', '/venues'];

  it('lights up 探す on the top page (v5 #1 の特殊対応)', () => {
    // タブに「ホーム」が無いため、これが無いとトップでどのタブも点灯しない。
    expect(isTabActive('/', EXPLORE)).toBe(true);
  });

  it('lights up 探す on each master list and its children', () => {
    for (const p of ['/titles', '/events', '/venues']) {
      expect(isTabActive(p, EXPLORE)).toBe(true);
    }
    expect(isTabActive('/titles/jujutsu-kaisen', EXPLORE)).toBe(true);
    expect(isTabActive('/titles/jujutsu-kaisen/occurrences', EXPLORE)).toBe(true);
    expect(isTabActive('/events/3/box-cafe', EXPLORE)).toBe(true);
  });

  it('does not light up 探す on unrelated pages', () => {
    for (const p of ['/articles', '/articles/01m02zq8', '/mypage', '/login']) {
      expect(isTabActive(p, EXPLORE)).toBe(false);
    }
  });

  /**
   * ★ `'/'` を基点に持つことで**全パスが一致してしまわない**ことの回帰テスト。
   * 素朴に `startsWith('/')` を書くとすべて true になる。
   */
  it('treats "/" as an exact match only, never as a prefix for everything', () => {
    expect(isTabActive('/', ['/'])).toBe(true);
    for (const p of ['/articles', '/mypage', '/titles']) {
      expect(isTabActive(p, ['/'])).toBe(false);
    }
  });

  /**
   * ★ 前方一致を広く取りすぎないことの回帰テスト。
   * `startsWith('/articles')` だと `/articles-archive` も点灯してしまう。
   */
  it('does not match sibling routes that merely share a prefix', () => {
    expect(isTabActive('/articles-archive', ['/articles'])).toBe(false);
    expect(isTabActive('/titles-old', ['/titles'])).toBe(false);
    // 配下パスは一致する (区切りの `/` がある)。
    expect(isTabActive('/articles/abc', ['/articles'])).toBe(true);
  });

  it('returns false for an empty base list', () => {
    expect(isTabActive('/titles', [])).toBe(false);
  });
});
