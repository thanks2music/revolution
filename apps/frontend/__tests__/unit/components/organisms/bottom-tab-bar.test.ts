import { describe, expect, it } from '@jest/globals';

import { EXPLORE_EXCLUDES, isTabActive, isTabCurrent } from '@/components/organisms/BottomTabBar';

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

describe('isTabCurrent (探す)', () => {
  const EXPLORE = { href: '/titles', excludes: EXPLORE_EXCLUDES };

  it('lights up 探す on the top page (v5 #1 の特殊対応)', () => {
    // タブに「ホーム」が無いため、これが無いとトップでどのタブも点灯しない。
    expect(isTabCurrent('/', EXPLORE)).toBe(true);
  });

  it('lights up 探す on each master list and its children', () => {
    for (const p of ['/titles', '/events', '/venues']) {
      expect(isTabCurrent(p, EXPLORE)).toBe(true);
    }
    expect(isTabCurrent('/titles/jujutsu-kaisen', EXPLORE)).toBe(true);
    expect(isTabCurrent('/titles/jujutsu-kaisen/occurrences', EXPLORE)).toBe(true);
  });

  it('lights up 探す on event pages under any event type (2026-11-03)', () => {
    // 第 1 階層が種別ごとに変わるので、基点の列挙では拾えない (判定を反転した理由)。
    for (const p of [
      '/collabo-cafe',
      '/collabo-cafe/3',
      '/collabo-cafe/3/box-cafe',
      '/chain-store/9',
    ]) {
      expect(isTabCurrent(p, EXPLORE)).toBe(true);
    }
  });

  it('does not light up 探す on the other tabs or the auth flow', () => {
    for (const p of [
      '/articles',
      '/articles/01m02zq8',
      '/mypage',
      '/login',
      '/onboarding',
      '/auth/callback',
    ]) {
      expect(isTabCurrent(p, EXPLORE)).toBe(false);
    }
  });

  it('uses the plain prefix check when excludes is absent (記事 / マイページ)', () => {
    expect(isTabCurrent('/articles/abc', { href: '/articles' })).toBe(true);
    expect(isTabCurrent('/collabo-cafe/3', { href: '/articles' })).toBe(false);
  });
});

describe('isTabActive', () => {
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
