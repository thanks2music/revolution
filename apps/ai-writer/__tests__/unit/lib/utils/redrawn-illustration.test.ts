import { describe, expect, it } from '@jest/globals';

import {
  deriveRedrawnWords,
  mentionsRedrawnIllustration,
  pageRedrawnWords,
  redrawnIllustrationWord,
  redrawnWordInGoodsSentences,
} from '@/lib/utils/redrawn-illustration';

/** Layer 1: 公式ページの「描き下ろし」「描き起こし」の判定 */
describe('mentionsRedrawnIllustration', () => {
  it('漢字とひらがなの表記を拾う', () => {
    expect(mentionsRedrawnIllustration('描き下ろしイラスト')).toBe(true);
    expect(mentionsRedrawnIllustration('描きおこしイラスト')).toBe(true);
    expect(mentionsRedrawnIllustration('オリジナルイラスト')).toBe(false);
    expect(mentionsRedrawnIllustration(null)).toBe(false);
  });
});

describe('redrawnIllustrationWord', () => {
  it('最初に見つかった語を、漢字の表記にそろえて返す', () => {
    expect(redrawnIllustrationWord([null, '描きおろしの衣装'])).toBe('描き下ろし');
    expect(redrawnIllustrationWord(['描き起こしイラスト', '描き下ろし'])).toBe('描き起こし');
    expect(redrawnIllustrationWord(['描きおこし'])).toBe('描き起こし');
  });

  it('どこにも無ければ null', () => {
    expect(redrawnIllustrationWord(['オリジナル', undefined])).toBeNull();
    expect(redrawnIllustrationWord([])).toBeNull();
  });
});

describe('redrawnWordInGoodsSentences', () => {
  it('「グッズ」を含む文だけから探す。インラインのタグでは文を区切らない', () => {
    expect(redrawnWordInGoodsSentences('<p>今回のために<strong>描き起こし</strong>ミニキャラのグッズも登場！</p>')).toBe('描き起こし');
    expect(redrawnWordInGoodsSentences('<p>描き下ろしミニキャラのコースターをプレゼント。</p><p>グッズも販売します。</p>')).toBeNull();
  });
});

describe('pageRedrawnWords', () => {
  it('グッズのページは、ページ全体の語をグッズの文脈の語にする', () => {
    expect(pageRedrawnWords('<p>描き下ろしイラストの缶バッジ</p>', true)).toEqual({ page: '描き下ろし', goods: '描き下ろし' });
  });

  it('ほかのページは、「グッズ」を含む文の語だけをグッズの文脈の語にする', () => {
    expect(pageRedrawnWords('<p>描き下ろしミニキャラのコースターをプレゼント。</p>', false)).toEqual({ page: '描き下ろし', goods: null });
    expect(pageRedrawnWords('<p>お知らせ</p>', false)).toEqual({ page: null, goods: null });
  });
});

describe('deriveRedrawnWords', () => {
  const none = { page: null, goods: null };

  it('グッズの文脈の語は、グッズのページ → グッズ名 → トップの「グッズ」を含む文 → ほかのページの順', () => {
    expect(
      deriveRedrawnWords({
        officialHtml: '<p>描き起こしミニキャラのグッズ</p>',
        subpages: [{ kind: 'goods', redrawn: { page: '描き下ろし', goods: '描き下ろし' } }],
        goodsNames: [],
      })
    ).toEqual({ page: '描き起こし', goods: '描き下ろし' });
    expect(deriveRedrawnWords({ officialHtml: '', subpages: [], goodsNames: ['缶バッジ 描き下ろしver.'] })).toEqual({
      page: null,
      goods: '描き下ろし',
    });
    expect(
      deriveRedrawnWords({ officialHtml: '<p>今回のために描き起こしミニキャラのグッズも登場！</p>', subpages: [], goodsNames: [] })
    ).toEqual({ page: '描き起こし', goods: '描き起こし' });
  });

  it('ノベルティだけが描き下ろしなら、ページ全体の語だけがあり、グッズの文脈の語は null', () => {
    expect(
      deriveRedrawnWords({
        officialHtml: '<p>お知らせ</p>',
        subpages: [
          { kind: 'novelty', redrawn: { page: '描き下ろし', goods: null } },
          { kind: 'goods', redrawn: none },
        ],
        goodsNames: ['アクリルスタンド'],
      })
    ).toEqual({ page: '描き下ろし', goods: null });
  });
});
