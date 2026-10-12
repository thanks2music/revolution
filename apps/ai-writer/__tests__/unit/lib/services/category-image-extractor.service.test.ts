import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { CategoryImageExtractorService } from '@/lib/services/category-image-extractor.service';
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
  exclude_patterns: ['logo', 'icon', 'line'],
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
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: '',
    text: async () => html,
  })) as unknown as typeof global.fetch;
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

  it('http で始まる相対パスも、ページの origin からの相対として解決する', async () => {
    mockFetchHtml('<html><body><img src="httpdocs/menu.jpg"></body></html>');
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/httpdocs/menu.jpg']);
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
        return html === undefined
          ? { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
          : { ok: true, status: 200, statusText: '', text: async () => html };
      }) as unknown as typeof global.fetch;
    }

    const TOP = 'https://heroaca-cafe.ltr-online.com/';
    const MENU = 'https://heroaca-cafe.ltr-online.com/lp/cafe-menu';
    const TOKYO = 'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s004';
    const OSAKA = 'https://heroaca-cafe.ltr-online.com/lp/heroaca-cafe-s019';
    const venuePage = (area: string) =>
      `<html><body><header><img src="/img/site-header.jpg"></header><main><h1>${area} INFORMATION</h1><h2>ノベルティ</h2><p>「ホログラムステッカー」を1枚プレゼント!</p><img src="/img/novelty-${area}.jpg"></main></body></html>`;

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

    it('ノベルティの下層ページが無ければ、最初の会場の案内ページの本文ブロックの画像をノベルティの画像にする (ヘッダーの画像は使わない)', async () => {
      mockFetchByUrl({ [TOKYO]: venuePage('TOKYO'), [OSAKA]: venuePage('OSAKA') });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, {}, [TOKYO, OSAKA]);

      expect(result.novelty).toEqual(['https://heroaca-cafe.ltr-online.com/img/novelty-TOKYO.jpg']);
      expect(result.sources.novelty).toBe(TOKYO);
    });

    it('下層ページが無いサイトでは、会場のページの画像より先にトップページへの退避が働き、残った空きを会場のページで補う', async () => {
      mockFetchByUrl({ [TOKYO]: venuePage('TOKYO') });
      const service = new CategoryImageExtractorService(configLoader);
      const topHtml = '<html><body><main>' + [1, 2, 3].map((n) => `<img src="/img/top-${n}.jpg">`).join('') + '</main></body></html>';

      const result = await service.extractCategoryImages(TOP, topHtml, {}, [TOKYO]);

      // トップの 3 枚はメニューに入り (3 カテゴリとも空だったため退避が働く)、空のノベルティは会場のページから補う
      expect(result.sources.menu).toBe(TOP);
      expect(result.menu).toHaveLength(3);
      expect(result.sources.novelty).toBe(TOKYO);
    });

    it('取得に失敗した会場のページは飛ばし、トップや取得済みのページは読み直さない', async () => {
      mockFetchByUrl({ [MENU]: '<html><body><main><p>メニュー</p></main></body></html>', [OSAKA]: venuePage('OSAKA') });
      const service = new CategoryImageExtractorService(configLoader);

      const result = await service.extractCategoryImages(TOP, null, { menu: [MENU] }, [TOP, `${MENU}/`, TOKYO, OSAKA]);

      expect(result.pages.map((page) => page.url)).toEqual([MENU, OSAKA]);
      expect((global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]))).toEqual([MENU, TOKYO, OSAKA]);
    });
  });
});
