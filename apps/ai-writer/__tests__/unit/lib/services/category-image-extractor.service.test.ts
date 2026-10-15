import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { CategoryImageExtractorService, findImagesByAlt } from '@/lib/services/category-image-extractor.service';

// ページの取得は SSRF ガード (DNS で内部アドレスを弾く) を通る。テストではネットワークに出ず、公開アドレスに解決させる
jest.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));
import type { ConfigLoaderService } from '@/lib/services/config-loader.service';

/**
 * 下層ページ (menu / goods) からの画像抽出を `global.fetch` の mock で固定する。
 *
 * fixture は heroaca-cafe.ltr-online.com の `/lp/goods` (2026-10-10 取得) の構造を写したもの。
 * Inertia.js のサイトは生 HTML に `<img>` が 1 枚も無く、画像は `data-page` の JSON に入っている。
 */

const IMAGE_CONFIG = {
  max_images_per_category: 5,
  min_image_size: { width: 200, height: 200 },
  // store-url-patterns.yaml の実際の値の一部。`line` はホスト名の ltr-online に部分一致する
  exclude_patterns: ['logo', 'icon', 'line', 'banner'],
  novelty_alt_keywords: ['特典', 'ノベルティ', 'novelty'],
};

const configLoader = {
  loadStoreUrlPatterns: async () => ({ image_extraction: IMAGE_CONFIG }),
} as unknown as ConfigLoaderService;

/** Inertia の root 要素を組み立てる (属性値は JSON をエンティティ escape したもの)。 */
function buildInertiaHtml(page: unknown): string {
  const json = JSON.stringify(page)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><body><div id="app" data-page="${json}"></div></body></html>`;
}

const GOODS_IMAGE = 'https://images.ltr-online.com/heroaca-cafe/260825_heroaca_cafe_comp_acrylstand.jpg';

const INERTIA_GOODS_PAGE = buildInertiaHtml({
  component: 'lp/ShowSiteLpContent',
  props: {
    content: {
      body: `<div class="product"><img alt="ミニアクリルスタンド（ランダム7種）" src="${GOODS_IMAGE}"></div>`,
    },
  },
});

const originalFetch = global.fetch;

function mockFetchHtml(html: string): void {
  global.fetch = jest.fn(async () => new Response(html, { status: 200 })) as unknown as typeof global.fetch;
}

describe('CategoryImageExtractorService.extractCategoryImages', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('Inertia.js の下層ページでも data-page 内の画像を拾う', async () => {
    mockFetchHtml(INERTIA_GOODS_PAGE);
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://heroaca-cafe.ltr-online.com/', null, {
      goods: ['https://heroaca-cafe.ltr-online.com/lp/goods'],
    });

    expect(result.goods).toEqual([GOODS_IMAGE]);
    expect(result.sources.goods).toBe('https://heroaca-cafe.ltr-online.com/lp/goods');
    // HTML 自体は残さず、「描き下ろし」の記載の有無だけを返す
    expect(result.mentionsRedrawnIllustration).toBe(false);
  });

  it('下層ページの本文ブロックに「描き下ろし」があれば mentionsRedrawnIllustration を立てる', async () => {
    mockFetchHtml(
      '<html><body><nav>ナビ</nav><main><h2>グッズ</h2><p>描き下ろしイラストを使用したアクリルスタンド</p><img src="/images/goods-1.jpg"></main></body></html>'
    );
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      goods: ['https://example.com/goods/'],
    });

    expect(result.mentionsRedrawnIllustration).toBe(true);
    // グッズのページなので、グッズの文脈の語にもなる (切り詰める前の本文で調べる)
    expect(result.redrawnPages).toEqual([{ kind: 'goods', redrawn: { page: '描き下ろし', goods: '描き下ろし' } }]);
  });

  it('グッズ以外の下層ページは、「グッズ」を含む文の語だけをグッズの文脈の語にする', async () => {
    mockFetchHtml(
      '<html><body><main><h2>ノベルティ</h2><p>描き下ろしミニキャラのコースターを配布。</p><img src="/images/novelty-1.jpg"></main></body></html>'
    );
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      novelty: ['https://example.com/novelty/'],
    });

    expect(result.mentionsRedrawnIllustration).toBe(true);
    expect(result.redrawnPages).toEqual([{ kind: 'novelty', redrawn: { page: '描き下ろし', goods: null } }]);
  });

  it('通常の HTML の下層ページはこれまでどおり <img> から拾う', async () => {
    mockFetchHtml('<html><body><img src="/images/menu-1.jpg"><img src="/images/logo.png"></body></html>');
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/images/menu-1.jpg']);
  });

  it('除外パターンはパスだけに当て、ホスト名 (images.ltr-online.com) では落とさない', async () => {
    mockFetchHtml(
      '<html><body><img src="https://images.ltr-online.com/heroaca-cafe/menu.jpg"><img src="/sns/line.png"></body></html>',
    );
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://heroaca-cafe.ltr-online.com/', null, {
      menu: ['https://heroaca-cafe.ltr-online.com/lp/cafe-menu'],
    });

    expect(result.menu).toEqual(['https://images.ltr-online.com/heroaca-cafe/menu.jpg']);
  });

  it('画像プロキシのクエリに含まれるファイル名にも除外パターンを当てる', async () => {
    mockFetchHtml(
      '<html><body>' +
        '<img src="/_next/image?url=%2Fimages%2Fsns_icon.png&w=640">' +
        '<img src="/_next/image?url=%2Fimages%2Fmenu_01.jpg&w=640">' +
        '</body></html>',
    );
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/_next/image?url=%2Fimages%2Fmenu_01.jpg&w=640']);
  });

  it('クエリのデコードに失敗したら、デコードせずに除外パターンを当てる', async () => {
    // %E0%A4%A は途中で切れた UTF-8 で decodeURIComponent が throw する。エンコードされたままの
    // `%2Fimages%2Flogo.png` には `logo` が部分一致するので除外され、`menu` の方は残る
    mockFetchHtml(
      '<html><body>' +
        '<img src="/_next/image?url=%2Fimages%2Flogo.png&bad=%E0%A4%A">' +
        '<img src="/_next/image?url=%2Fimages%2Fmenu_01.jpg&bad=%E0%A4%A">' +
        '</body></html>',
    );
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/_next/image?url=%2Fimages%2Fmenu_01.jpg&bad=%E0%A4%A']);
  });

  it('http で始まる相対パスも相対パスとして、ページの URL で解決する (ブラウザと同じ)', async () => {
    mockFetchHtml('<html><body><img src="httpdocs/menu.jpg"></body></html>');
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/menu/httpdocs/menu.jpg']);
  });

  it('URL として解釈できない src は飛ばし、他の画像の抽出を止めない', async () => {
    mockFetchHtml('<html><body><img src="https://[cdn.example.com/a.jpg"><img src="/img/menu.jpg"></body></html>');
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/img/menu.jpg']);
  });

  describe('下層ページの本文 (pages) と会場の案内ページ', () => {
    /** URL ごとに返す HTML を切り替える */
    function mockFetchByUrl(pages: Record<string, string>): void {
      global.fetch = jest.fn(async (url: unknown) => {
        const html = pages[String(url)];
        return html === undefined ? new Response('', { status: 404 }) : new Response(html, { status: 200 });
      }) as unknown as typeof global.fetch;
    }

    const TOP = 'https://heroaca-cafe.ltr-online.com/';
    const MENU = 'https://heroaca-cafe.ltr-online.com/lp/cafe-menu';
    const TOKYO = 'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s004';
    const OSAKA = 'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s019';
    const venuePage = (area: string) =>
      `<html><body><header><img src="/img/site-header.jpg" alt="特典"></header><main><h1>${area} INFORMATION</h1><h2>ノベルティ</h2><p>「ホログラムステッカー」を1枚プレゼント!</p><img src="/img/tokutenbanner-${area}.jpg" alt="事前予約者限定カフェ利用特典"><img src="/img/map-${area}.jpg" alt="アクセスマップ"></main></body></html>`;
    const GUIDE = 'https://heroaca-cafe.ltr-online.com/lp/guide';
    const guidePage = '<html><body><main><h1>ご利用ガイド</h1><img src="/img/step_01.png" alt="STEP1"></main></body></html>';

    it('取得した下層ページと会場の案内ページの本文を、種類つきで残す', async () => {
      mockFetchByUrl({
        [MENU]: '<html><body><main><h2>PIZZA</h2><p>【緑谷出久】バジルクリームとルッコラ 各¥2,090(税込)</p></main></body></html>',
        [TOKYO]: venuePage('TOKYO'),
        [OSAKA]: venuePage('OSAKA'),
      });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, { menu: [MENU] }, [TOKYO, OSAKA]);

      expect(result.pages.map((page) => [page.kind, page.url])).toEqual([
        ['menu', MENU],
        ['venue', TOKYO],
        ['venue', OSAKA],
      ]);
      expect(result.pages[0].text).toContain('バジルクリームとルッコラ');
      expect(result.pages[1].text).toContain('ホログラムステッカー');
    });

    it('会場のページごとに、本文ブロックの画像のうち代替テキストが特典・ノベルティを示すものを候補として残す (除外パターン banner は当てない。ヘッダーと他の画像は使わない)', async () => {
      mockFetchByUrl({ [GUIDE]: guidePage, [TOKYO]: venuePage('TOKYO'), [OSAKA]: venuePage('OSAKA') });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, {}, [GUIDE, TOKYO, OSAKA]);

      expect(result.venueNoveltyImages).toEqual([
        { url: TOKYO, images: ['https://heroaca-cafe.ltr-online.com/img/tokutenbanner-TOKYO.jpg'] },
        { url: OSAKA, images: ['https://heroaca-cafe.ltr-online.com/img/tokutenbanner-OSAKA.jpg'] },
      ]);
    });

    it('ノベルティの画像を、画像の抽出の段階では会場のページから選ばない (利用ガイドの画像がノベルティに入った不具合の再発防止)', async () => {
      mockFetchByUrl({ [GUIDE]: guidePage, [TOKYO]: venuePage('TOKYO') });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, {}, [GUIDE, TOKYO]);

      expect(result.novelty).toEqual([]);
      expect(result.sources.novelty).toBeUndefined();
    });

    it('下層ページが無いサイトでは、トップページへの退避が働く (会場のページは使わない)', async () => {
      mockFetchByUrl({ [TOKYO]: venuePage('TOKYO') });
      const service = new CategoryImageExtractorService(configLoader);
      const topHtml = '<html><body><main>' + [1, 2, 3].map((n) => `<img src="/img/top-${n}.jpg">`).join('') + '</main></body></html>';

      const result = await service.extractCategoryImages(TOP, topHtml, {}, [TOKYO]);

      expect(result.sources.menu).toBe(TOP);
      expect(result.menu).toHaveLength(3);
      expect(result.novelty).toEqual([]);
    });

    it('内部アドレスのページは取得しない (SSRF ガード)', async () => {
      const internal = 'http://169.254.169.254/latest/meta-data';
      mockFetchByUrl({ [internal]: '<html><body><main><p>secret</p></main></body></html>' });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages('http://169.254.169.254/', null, {}, [internal]);

      expect(result.pages).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('取得に失敗した会場のページは飛ばし、トップや取得済みのページは読み直さない', async () => {
      mockFetchByUrl({ [MENU]: '<html><body><main><p>メニュー</p></main></body></html>', [OSAKA]: venuePage('OSAKA') });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, { menu: [MENU] }, [TOP, `${MENU}/`, TOKYO, OSAKA]);

      expect(result.pages.map((page) => page.url)).toEqual([MENU, OSAKA]);
      // 会場のページは並列に取るので、取得の順は決まらない (結果の pages の順は保つ)
      expect((global.fetch as jest.Mock).mock.calls.map((call) => String(call[0])).sort()).toEqual(
        [MENU, TOKYO, OSAKA].sort()
      );
    });
  });
});

describe('findImagesByAlt', () => {
  it('代替テキストが語を含む画像の絶対 URL を、重複を除いて返す (大文字・小文字は区別しない)', () => {
    const html =
      '<img src="/a.jpg" alt="ドリンク特典"><img src="/a.jpg" alt="ドリンク特典"><img src="/b.jpg" alt="NOVELTY"><img src="/c.jpg" alt="MENU"><img alt="特典">';

    expect(findImagesByAlt(html, 'https://example.com/lp/x', ['特典', 'novelty'])).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
  });

  it('data-src も読み、URL として読めない src は飛ばす。width / height の属性では落とさない (短辺は取得後に当てる)', () => {
    const html =
      '<img data-src="/lazy.jpg" alt="特典"><img src="http://[bad" alt="特典"><img src="/icon.png" alt="特典" width="40" height="40"><img src="/big.jpg" alt="特典" width="600" height="600">';

    expect(findImagesByAlt(html, 'https://example.com/', ['特典'])).toEqual([
      'https://example.com/lazy.jpg',
      'https://example.com/icon.png',
      'https://example.com/big.jpg',
    ]);
  });

  it('遅延読み込みの data: のダミーの src より data-src を使い、data: しか無い画像は飛ばす', () => {
    const html =
      '<img src="data:image/gif;base64,R0lGOD" data-src="/real.jpg" alt="特典"><img src="data:image/png;base64,AAA" alt="特典">';

    expect(findImagesByAlt(html, 'https://example.com/', ['特典'])).toEqual(['https://example.com/real.jpg']);
  });

  it('語が無ければ何も返さない', () => {
    expect(findImagesByAlt('<img src="/a.jpg" alt="特典">', 'https://example.com/', [])).toEqual([]);
  });
});
