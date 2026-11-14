import { describe, expect, it } from '@jest/globals';

import { buildArchivePageContent, collectSectionImages, removeNoise } from '@/lib/archive-source/archive-content';

import { ARTICLE_HTML, ARTICLE_URL, SOURCE } from './fixtures';

const uploads = (name: string) => `https://archive.example.com/wp-content/uploads/${name}`;

describe('removeNoise', () => {
  it('removes ads, affiliate boxes, embeds and banners', () => {
    const html = removeNoise(ARTICLE_HTML, SOURCE.noise_selectors);
    expect(html).not.toContain('adsbygoogle');
    expect(html).not.toContain('affiliate');
    expect(html).not.toContain('twitter-tweet');
    expect(html).not.toContain('app-banner');
    expect(html).toContain('menu-1.jpg');
  });
});

describe('collectSectionImages', () => {
  const clean = removeNoise(ARTICLE_HTML, SOURCE.noise_selectors);
  const images = collectSectionImages(clean, ARTICLE_URL, SOURCE.images);

  it('puts each section image into its category, reading lazy-load sources and relative paths', () => {
    expect(images.menu).toEqual([uploads('menu-1.jpg'), uploads('menu-2.jpg')]);
    expect(images.novelty).toEqual([uploads('novelty-1.jpg')]);
    // menu-2.jpg is already in the menu
    expect(images.goods).toEqual([uploads('goods-1.jpg')]);
  });

  it('does not use images before the first category heading or in other sections', () => {
    const all = [...images.menu, ...images.novelty, ...images.goods];
    expect(all).not.toContain(uploads('kv.jpg'));
    expect(all).not.toContain(uploads('map.jpg'));
  });

  it('keeps only the archive own uploads', () => {
    const noisy = collectSectionImages(ARTICLE_HTML, ARTICLE_URL, SOURCE.images);
    const all = [...noisy.menu, ...noisy.novelty, ...noisy.goods];
    expect(all.every((url) => url.startsWith(uploads('')))).toBe(true);
    expect(all.some((url) => url.includes('dummy.png') || url.includes('app-banner'))).toBe(false);
  });
});

describe('collectSectionImages without category headings (older articles)', () => {
  const html = `
<p><img src="/wp-content/uploads/kv.jpg"></p>
<h2>サンプル作品 × サンプル店 in 池袋</h2>
<p><img src="/wp-content/uploads/a.jpg"><img src="/wp-content/uploads/a.jpg"></p>
<h2>サンプル作品 × サンプル店 in 池袋の開催概要</h2>
<p><img src="/wp-content/uploads/b.jpg"></p>`;

  it('puts the images after the first heading into the event type default category', () => {
    const images = collectSectionImages(html, ARTICLE_URL, SOURCE.images, 'pop-up-store');
    expect(images.goods).toEqual([uploads('a.jpg'), uploads('b.jpg')]);
    expect(images.menu).toEqual([]);
  });

  it('uses no image when the event type has no default', () => {
    const images = collectSectionImages(html, ARTICLE_URL, SOURCE.images, 'collabo-cafe');
    expect([...images.menu, ...images.novelty, ...images.goods]).toEqual([]);
  });

  it('keeps the section rule when any heading has a keyword', () => {
    const images = collectSectionImages(ARTICLE_HTML, ARTICLE_URL, SOURCE.images, 'pop-up-store');
    expect(images.goods).toEqual([uploads('goods-1.jpg')]);
  });
});

describe('buildArchivePageContent', () => {
  it('builds the page inputs the pipeline reads from the official site', () => {
    const { contentHtml, categoryImages } = buildArchivePageContent(ARTICLE_HTML, ARTICLE_URL, SOURCE);

    expect(contentHtml.raw).not.toContain('adsbygoogle');
    expect(contentHtml.compacted).toContain('2019年1月22日');
    expect(contentHtml.compacted.length).toBeLessThan(contentHtml.raw.length);

    expect(categoryImages.all).toEqual([uploads('menu-1.jpg'), uploads('menu-2.jpg'), uploads('novelty-1.jpg'), uploads('goods-1.jpg')]);
    expect(categoryImages.pages).toEqual([]);
    expect(categoryImages.imageAlts).toEqual({});
    expect(categoryImages.mentionsRedrawnIllustration).toBe(true);
    expect(categoryImages.redrawnPages).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'goods', redrawn: expect.objectContaining({ page: '描き下ろし' }) })]),
    );
  });
});
