import {
  articleImageSizes,
  formatJstDate,
  isArticleEyecatch,
  isOwnImageUrl,
  maxOptimizableWidth,
  nextImageUrl,
  toDimensions,
  toLightboxSlide,
} from '@/lib/mdx/article-image';

describe('isArticleEyecatch', () => {
  it('R2 の画像は冒頭に出す', () => {
    expect(isArticleEyecatch('https://images.anime-events.com/a.jpg')).toBe(true);
  });
  it('変換を許していない配信元の URL は出さない (/_next/image が 400 になる)', () => {
    expect(isArticleEyecatch('https://example.com/og.jpg')).toBe(false);
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

describe('maxOptimizableWidth', () => {
  it('高さが WebP の上限 (16,383px) 以下なら制限しない', () => {
    expect(maxOptimizableWidth(1200, 600)).toBeNull();
    expect(maxOptimizableWidth(800, 16383)).toBeNull();
  });
  it('極端に縦長なら、変換後の高さが上限に収まる最大の変換幅 (ヒロアカのメニュー画像)', () => {
    expect(maxOptimizableWidth(1920, 19600)).toBe(1200); // 1200 → 12,250px、1920 → 19,600px
    expect(maxOptimizableWidth(1920, 28300)).toBe(1080); // 1080 → 15,919px、1200 → 17,688px
  });
});

describe('toLightboxSlide', () => {
  const src = 'https://images.anime-events.com/collabo-cafe/2026/x/menu/a.jpg';

  it('元の幅を超える最小の変換幅まで並べ、その幅は実際に返る元の幅で表す (変換は拡大しない)', () => {
    const slide = toLightboxSlide({ src, alt: 'ノベルティ', width: 1000, height: 1000 });
    const last = slide.srcSet?.at(-1);
    expect(last).toEqual({ src: nextImageUrl(src, 1080), width: 1000, height: 1000 });
    expect(slide.src).toBe(nextImageUrl(src, 1080));
    expect(slide.srcSet?.every((s) => s.width <= 1000)).toBe(true);
  });

  it('元の幅が変換幅と同じなら、それが最大', () => {
    const slide = toLightboxSlide({ src, alt: '', width: 1200, height: 600 });
    expect(slide.src).toBe(nextImageUrl(src, 1200));
    expect(slide.srcSet?.find((s) => s.width === 640)?.height).toBe(320);
  });

  it('極端に縦長なら、変換後の高さが上限に収まる幅まで', () => {
    const slide = toLightboxSlide({ src, alt: '', width: 1920, height: 28300 });
    expect(slide.src).toBe(nextImageUrl(src, 1080));
    expect(Math.max(...(slide.srcSet ?? []).map((s) => s.height))).toBeLessThanOrEqual(16383);
  });

  it('寸法が分からなければ元の URL をそのまま使う', () => {
    expect(toLightboxSlide({ src, alt: 'x' })).toEqual({ src, alt: 'x' });
  });
});

describe('formatJstDate', () => {
  it('UTC の夜 (日本時間の朝) は日本時間の日付で出す', () => {
    expect(formatJstDate('2026-10-12T21:26:06.709Z')).toBe('2026年10月13日');
  });
});

describe('isOwnImageUrl', () => {
  it('自前の画像の配信元 (https) だけを許す', () => {
    expect(isOwnImageUrl('https://images.anime-events.com/a.jpg')).toBe(true);
    expect(isOwnImageUrl('http://images.anime-events.com/a.jpg')).toBe(false);
    expect(isOwnImageUrl('https://example.com/a.jpg')).toBe(false);
    expect(isOwnImageUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isOwnImageUrl('not a url')).toBe(false);
  });
});

describe('nextImageUrl', () => {
  it('URL を符号化し、品質は next.config の 75', () => {
    expect(nextImageUrl('https://a.example/b c.jpg', 640)).toBe(
      '/_next/image?url=https%3A%2F%2Fa.example%2Fb%20c.jpg&w=640&q=75'
    );
  });
});
