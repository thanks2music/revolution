import { sameSiteOfficialUrls } from '@/lib/utils/same-site-official-urls';

/**
 * Layer 1: 記事選別の公式 URL のうち、トップと同じサイトのページ (会場の案内ページ) を選ぶ。
 */
describe('sameSiteOfficialUrls', () => {
  const TOP = 'https://heroaca-cafe.ltr-online.com/';

  it('トップと同じホストのページだけを返し、トップ自身と重複は除く', () => {
    expect(
      sameSiteOfficialUrls(TOP, [
        'https://heroaca-cafe.ltr-online.com',
        'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s004',
        'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s004/',
        'https://x.com/boxcafe_space',
        'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s019',
      ])
    ).toEqual([
      'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s004',
      'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s019',
    ]);
  });

  it('www. の有無は同じサイトとみなす。URL として読めないものは除く', () => {
    expect(
      sameSiteOfficialUrls('https://www.example.com/cafe/', ['https://example.com/cafe/osaka', 'not a url'])
    ).toEqual(['https://example.com/cafe/osaka']);
  });

  it('公式 URL が無ければ空', () => {
    expect(sameSiteOfficialUrls(TOP, undefined)).toEqual([]);
  });
});
