/**
 * Layer 1 / 2: 記事 1 本分の画像のアップロードとアイキャッチの選択 (`upload-images-for-article.ts`、2026-10-13)。
 */
import sharp from 'sharp';
import {
  assertImageUploadConfig,
  eyecatchCandidates,
  itemImageTags,
  uploadImagesForArticle,
} from '@/lib/services/article-images/upload-images-for-article';
import { articleImageTags } from '@/lib/services/article-images/article-image-tag';
import type { ImageFetcher, ImageStore, UploadedArticleImage } from '@/lib/services/article-images/upload-article-images';

const uploaded = (sourceUrl: string, width: number, height: number, alt: string | null = null): UploadedArticleImage => ({
  sourceUrl,
  alt,
  width,
  height,
  segments: [{ url: `https://images.example.com/${sourceUrl.split('/').pop()}.webp`, width, height }],
});

describe('eyecatchCandidates', () => {
  it('og:image → 最初の横長の画像 → 最初の画像の順 (重複は除く)', () => {
    const images = [uploaded('https://a.test/tall', 600, 900), uploaded('https://a.test/wide', 1300, 1000)];

    expect(eyecatchCandidates('https://a.test/og', images, 1.3)).toEqual([
      { sourceUrl: 'https://a.test/og', origin: 'og' },
      { sourceUrl: 'https://a.test/wide', origin: 'landscape' },
      { sourceUrl: 'https://a.test/tall', origin: 'first' },
    ]);
  });

  it('横長が最初の画像なら 1 つにまとめる。何も無ければ空', () => {
    expect(eyecatchCandidates(null, [uploaded('https://a.test/wide', 1600, 900)], 1.3)).toEqual([
      { sourceUrl: 'https://a.test/wide', origin: 'landscape' },
    ]);
    expect(eyecatchCandidates(null, [], 1.3)).toEqual([]);
  });

  it('比が閾値ちょうどの画像は横長に数える', () => {
    expect(eyecatchCandidates(null, [uploaded('https://a.test/a', 1300, 1000)], 1.3)[0].origin).toBe('landscape');
  });
});

describe('itemImageTags', () => {
  it('品目ごとの MDX (代替テキストは品名、複数枚なら番号) と、照合できなかった画像を返す', () => {
    const badge1 = uploaded('https://a.test/b1', 800, 800, '缶バッジ');
    const badge2 = uploaded('https://a.test/b2', 800, 800, '2枚目_缶バッジ');
    const sticker = uploaded('https://a.test/s', 800, 800, 'ステッカー');
    const other = uploaded('https://a.test/o', 800, 800, '店内');

    const result = itemImageTags(['缶バッジ（全7種）', 'ステッカー', 'クリアファイル'], [badge1, other, badge2, sticker]);

    expect(result.tags).toEqual([
      [articleImageTags(badge1.segments, '缶バッジ（全7種） 1'), articleImageTags(badge2.segments, '缶バッジ（全7種） 2')].join('\n\n'),
      articleImageTags(sticker.segments, 'ステッカー'),
      '',
    ]);
    expect(result.rest).toEqual([other]);
    expect(result.matched).toBe(3);
  });
});

describe('uploadImagesForArticle', () => {
  const config = {
    min_short_side: 300,
    eyecatch_landscape_ratio: 1.3,
    upload: {
      max_width: 1600,
      webp_quality: 85,
      webp_min_quality: 50,
      quality_step: 10,
      max_bytes: 5 * 1024 * 1024,
      split_ratio: 3,
      segment_height: 4800,
    },
  };

  async function png(width: number, height: number, color: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: color, g: 10, b: 10 } } }).png().toBuffer();
  }

  function store(): ImageStore {
    return {
      listKeys: async () => [],
      put: async () => undefined,
      publicUrlFor: (key) => `https://images.example.com/${key}`,
    };
  }

  it('カテゴリごとに上げ、代替テキストを付ける。og:image が取れなければ本文の横長の画像から JPEG のアイキャッチを作る', async () => {
    const images: Record<string, Buffer> = {
      'https://a.test/menu-tall.png': await png(600, 900, 10),
      'https://a.test/goods-wide.png': await png(1600, 900, 20),
    };
    const fetcher: ImageFetcher = async (url) => {
      if (!images[url]) throw new Error(`404: ${url}`);
      return { buffer: images[url], contentType: 'image/png' };
    };

    const result = await uploadImagesForArticle(
      {
        ogImage: 'https://a.test/og-missing.jpg',
        menu: ['https://a.test/menu-tall.png'],
        novelty: [],
        goods: ['https://a.test/goods-wide.png'],
        imageAlts: { 'https://a.test/goods-wide.png': '缶バッジ' },
      },
      { folder: 'f', config, store: store(), fetcher }
    );

    expect(result.categories.menu.map((i) => i.sourceUrl)).toEqual(['https://a.test/menu-tall.png']);
    expect(result.categories.goods[0].alt).toBe('缶バッジ');
    expect(result.eyecatch).toMatchObject({
      sourceUrl: 'https://a.test/goods-wide.png',
      origin: 'landscape',
      width: 1600,
      height: 900,
      url: expect.stringMatching(/^https:\/\/images\.example\.com\/f\/[0-9a-f]{32}\.jpg$/),
    });
    expect(result.skipped).toEqual([
      { sourceUrl: 'https://a.test/og-missing.jpg', kind: 'failed', reason: expect.stringContaining('アイキャッチ (og)') },
    ]);
    expect(result.newObjects).toBe(3);
  });

  it('同じ画像が複数のカテゴリ・同じカテゴリに何度あっても、最初の 1 回だけ載せる (取得も 1 回)', async () => {
    const buffer = await png(800, 800, 30);
    const fetcher = jest.fn<ReturnType<ImageFetcher>, Parameters<ImageFetcher>>(async () => ({ buffer, contentType: 'image/png' }));

    const result = await uploadImagesForArticle(
      { ogImage: null, menu: ['https://a.test/x.png', 'https://a.test/x.png'], novelty: [], goods: ['https://a.test/x.png'], imageAlts: {} },
      { folder: 'f', config, store: null, fetcher }
    );

    expect(result.categories.menu).toHaveLength(1);
    expect(result.categories.goods).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2); // 本文の 1 回と、アイキャッチ (og:image が無い) の 1 回
  });

  it('画像が 1 枚も無ければアイキャッチも無い', async () => {
    const result = await uploadImagesForArticle(
      { ogImage: null, menu: [], novelty: [], goods: [], imageAlts: {} },
      { folder: 'f', config, store: store(), fetcher: async () => ({ buffer: Buffer.alloc(0), contentType: null }) }
    );
    expect(result.eyecatch).toBeUndefined();
    expect(result.newObjects).toBe(0);
  });
});

describe('assertImageUploadConfig', () => {
  it('Templates が古く、画像の設定が欠けていれば、欠けた名前を挙げて止める', () => {
    expect(() => assertImageUploadConfig({ min_short_side: 300 })).toThrow(
      'store-url-patterns.yaml の image_extraction に eyecatch_landscape_ratio / upload が無い'
    );
    expect(() => assertImageUploadConfig(undefined)).toThrow('min_short_side / eyecatch_landscape_ratio / upload');
  });
});
