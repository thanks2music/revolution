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
  exclude_patterns: ['logo', 'icon'],
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
  });

  it('通常の HTML の下層ページはこれまでどおり <img> から拾う', async () => {
    mockFetchHtml('<html><body><img src="/images/menu-1.jpg"><img src="/images/logo.png"></body></html>');
    const service = new CategoryImageExtractorService(configLoader);

    const result = await service.extractCategoryImages('https://example.com/', null, {
      menu: ['https://example.com/menu/'],
    });

    expect(result.menu).toEqual(['https://example.com/images/menu-1.jpg']);
  });
});
