import {
  articleImageSizes,
  isArticleEyecatch,
  nextImageUrl,
  toDimensions,
  toLightboxSlide,
} from '@/lib/mdx/article-image';

describe('isArticleEyecatch', () => {
  it('R2 の画像は冒頭に出す', () => {
    expect(isArticleEyecatch('https://images.anime-events.com/a.jpg')).toBe(true);
  });
  it('サイト共通の OG 画像・空・null は出さない', () => {
    expect(isArticleEyecatch('/images/og-image-compressed.png')).toBe(false);
    expect(isArticleEyecatch('')).toBe(false);
    expect(isArticleEyecatch(null)).toBe(false);
    expect(isArticleEyecatch(undefined)).toBe(false);
  });
});

describe('toDimensions', () => {
  it('MDX の文字列の属性を数にする', () => {
    expect(toDimensions('800', '1000')).toEqual({ width: 800, height: 1000 });
    expect(toDimensions(1200, 600)).toEqual({ width: 1200, height: 600 });
  });
  it('片方が無い・0・数でなければ null', () => {
    expect(toDimensions('800', undefined)).toBeNull();
    expect(toDimensions(0, 100)).toBeNull();
    expect(toDimensions('abc', '100')).toBeNull();
  });
});

describe('articleImageSizes', () => {
  it('PC では元の幅と記事の幅 (1050px) の小さい方', () => {
    expect(articleImageSizes(800)).toBe('(max-width: 1167px) 90vw, 800px');
    expect(articleImageSizes(1920)).toBe('(max-width: 1167px) 90vw, 1050px');
  });
  it('寸法が分からなければ記事の幅', () => {
    expect(articleImageSizes()).toBe('(max-width: 1167px) 90vw, 1050px');
  });
});

describe('toLightboxSlide', () => {
  const src = 'https://images.anime-events.com/collabo-cafe/2026/x/menu/a.jpg';

  it('元の幅以下の変換版だけを srcSet に並べ、src は最大のもの', () => {
    const slide = toLightboxSlide({ src, alt: 'メニュー', width: 1200, height: 600 });
    const widths = slide.srcSet?.map((s) => s.width) ?? [];
    expect(Math.max(...widths)).toBe(1200);
    expect(widths.every((w) => w <= 1200)).toBe(true);
    expect(slide.src).toBe(nextImageUrl(src, 1200));
    expect(slide.srcSet?.find((s) => s.width === 640)?.height).toBe(320);
  });

  it('変換できる幅は next.config の値だけ (元の幅 1000 → 最大 828)', () => {
    const slide = toLightboxSlide({ src, alt: '', width: 1000, height: 1000 });
    expect(slide.src).toBe(nextImageUrl(src, 828));
  });

  it('寸法が分からなければ元の URL をそのまま使う', () => {
    expect(toLightboxSlide({ src, alt: 'x' })).toEqual({ src, alt: 'x' });
  });
});

describe('nextImageUrl', () => {
  it('URL を符号化し、品質は next.config の 75', () => {
    expect(nextImageUrl('https://a.example/b c.jpg', 640)).toBe(
      '/_next/image?url=https%3A%2F%2Fa.example%2Fb%20c.jpg&w=640&q=75'
    );
  });
});
