/**
 * Layer 2: 記事の画像の取得・加工・R2 へのアップロード (`upload-article-images.ts`、2026-10-13)。
 * 取得 (fetcher) と R2 (store) は差し替え、画像は sharp でその場で作る。
 */
import sharp from 'sharp';
import type { ImageExtractionConfig } from '@/lib/types/subpage-detection';
import {
  contentKey,
  r2ImageStore,
  uploadArticleImages,
  uploadEyecatchImage,
  type ImageFetcher,
  type ImageStore,
} from '@/lib/services/article-images/upload-article-images';

const CONFIG: Pick<ImageExtractionConfig, 'min_short_side' | 'upload'> = {
  min_short_side: 300,
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

function image(width: number, height: number, format: 'png' | 'jpeg' = 'png', color = 120): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: color, g: 60, b: 30 } } });
  return (format === 'png' ? base.png() : base.jpeg()).toBuffer();
}

/** URL → 画像。無い URL は取得の失敗 */
function fetcherOf(images: Record<string, { buffer: Buffer; contentType?: string }>): jest.MockedFunction<ImageFetcher> {
  return jest.fn(async (url: string) => {
    const found = images[url];
    if (!found) throw new Error(`404: ${url}`);
    return { buffer: found.buffer, contentType: found.contentType ?? 'image/png' };
  });
}

function memoryStore(existing: string[] = []): ImageStore & { puts: string[] } {
  const keys = new Set(existing);
  const puts: string[] = [];
  return {
    puts,
    exists: jest.fn(async (key: string) => keys.has(key)),
    put: jest.fn(async (key: string) => {
      keys.add(key);
      puts.push(key);
    }),
    publicUrlFor: (key: string) => `https://images.example.com/${key}`,
  };
}

describe('contentKey', () => {
  it('同じ中身なら同じキー、違えば違うキー (sha256 の先頭 32 桁)', () => {
    const a = contentKey('cafe/2026/X', Buffer.from('a'), 'webp');
    expect(a).toMatch(/^cafe\/2026\/X\/[0-9a-f]{32}\.webp$/);
    expect(contentKey('cafe/2026/X', Buffer.from('a'), 'webp')).toBe(a);
    expect(contentKey('cafe/2026/X', Buffer.from('b'), 'webp')).not.toBe(a);
  });
});

describe('uploadArticleImages', () => {
  it('加工した WebP を上げ、寸法と R2 の URL を返す。並びは元の順', async () => {
    const fetcher = fetcherOf({
      'https://a.test/1.png': { buffer: await image(800, 600) },
      'https://a.test/2.png': { buffer: await image(2400, 1200, 'png', 200) },
    });
    const store = memoryStore();

    const result = await uploadArticleImages(
      [
        { url: 'https://a.test/1.png', alt: 'マルゲリータ' },
        { url: 'https://a.test/2.png', alt: null },
      ],
      { folder: 'cafe/2026/X', config: CONFIG, store, dryRun: false, fetcher }
    );

    expect(result.skipped).toEqual([]);
    expect(result.newObjects).toBe(2);
    expect(result.uploaded.map((u) => [u.sourceUrl, u.alt, u.width, u.height])).toEqual([
      ['https://a.test/1.png', 'マルゲリータ', 800, 600],
      ['https://a.test/2.png', null, 2400, 1200],
    ]);
    expect(result.uploaded[1].segments).toEqual([
      { url: `https://images.example.com/${store.puts[1]}`, width: 1600, height: 800 },
    ]);
    expect(store.puts.every((key) => key.endsWith('.webp'))).toBe(true);
  });

  it('R2 に既にあるキーは上げない (記事の更新で、差分の無い画像を上げ直さない)', async () => {
    const buffer = await image(800, 600);
    const fetcher = fetcherOf({ 'https://a.test/1.png': { buffer } });
    const first = memoryStore();
    await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      folder: 'f',
      config: CONFIG,
      store: first,
      dryRun: false,
      fetcher,
    });

    const second = memoryStore(first.puts);
    const result = await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      folder: 'f',
      config: CONFIG,
      store: second,
      dryRun: false,
      fetcher,
    });

    expect(second.puts).toEqual([]);
    expect(result.newObjects).toBe(0);
    expect(result.uploaded[0].segments[0].url).toBe(`https://images.example.com/${first.puts[0]}`);
  });

  it('短辺が足りない画像は too_small、取得に失敗した画像は failed で飛ばし、残りは続ける', async () => {
    const fetcher = fetcherOf({
      'https://a.test/icon.png': { buffer: await image(400, 100) },
      'https://a.test/ok.png': { buffer: await image(600, 600) },
    });

    const result = await uploadArticleImages(
      [
        { url: 'https://a.test/icon.png', alt: null },
        { url: 'https://a.test/missing.png', alt: null },
        { url: 'https://a.test/ok.png', alt: null },
      ],
      { folder: 'f', config: CONFIG, store: memoryStore(), dryRun: false, fetcher }
    );

    expect(result.uploaded.map((u) => u.sourceUrl)).toEqual(['https://a.test/ok.png']);
    expect(result.skipped).toEqual([
      { sourceUrl: 'https://a.test/icon.png', kind: 'too_small', reason: expect.stringContaining('短辺が 300px 未満') },
      { sourceUrl: 'https://a.test/missing.png', kind: 'failed', reason: '404: https://a.test/missing.png' },
    ]);
  });

  it('縦長の画像は分割した片を上から順に返す', async () => {
    const fetcher = fetcherOf({ 'https://a.test/tall.png': { buffer: await image(1600, 6000) } });

    const result = await uploadArticleImages([{ url: 'https://a.test/tall.png', alt: null }], {
      folder: 'f',
      config: CONFIG,
      store: memoryStore(),
      dryRun: false,
      fetcher,
    });

    expect(result.uploaded[0].segments.map((s) => s.height)).toEqual([4800, 1200]);
    expect(result.newObjects).toBe(2);
  });

  it('dry-run では R2 に触らず、URL を [DRY RUN] にする (加工はするので寸法は本物)', async () => {
    const fetcher = fetcherOf({ 'https://a.test/1.png': { buffer: await image(800, 600) } });
    const store = memoryStore();

    const result = await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      folder: 'f',
      config: CONFIG,
      store,
      dryRun: true,
      fetcher,
    });

    expect(store.exists).not.toHaveBeenCalled();
    expect(store.puts).toEqual([]);
    expect(result.uploaded[0].segments[0]).toMatchObject({ url: expect.stringMatching(/^\[DRY RUN\] .*\/f\/[0-9a-f]{32}\.webp$/), width: 800, height: 600 });
  });

  it('同じ URL は 1 回だけ取得する', async () => {
    const fetcher = fetcherOf({ 'https://a.test/1.png': { buffer: await image(800, 600) } });

    const result = await uploadArticleImages(
      [
        { url: 'https://a.test/1.png', alt: null },
        { url: 'https://a.test/1.png', alt: 'x' },
      ],
      { folder: 'f', config: CONFIG, store: memoryStore(), dryRun: false, fetcher }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.uploaded).toHaveLength(1);
  });
});

describe('uploadEyecatchImage', () => {
  it('形式を変えずに上げ (SNS で読めるように)、寸法を測る', async () => {
    const buffer = await image(1200, 630, 'jpeg');
    const store = memoryStore();

    const result = await uploadEyecatchImage('https://a.test/og.jpg', {
      folder: 'f',
      store,
      dryRun: false,
      fetcher: fetcherOf({ 'https://a.test/og.jpg': { buffer, contentType: 'image/jpeg; charset=binary' } }),
    });

    expect(result).toEqual({ url: `https://images.example.com/${store.puts[0]}`, width: 1200, height: 630, uploaded: true });
    expect(store.puts[0]).toBe(contentKey('f', buffer, 'jpg'));
    expect(store.put).toHaveBeenCalledWith(store.puts[0], buffer, 'image/jpeg');
  });

  it('Content-Type が画像でなければ、中身の形式で拡張子を決める', async () => {
    const buffer = await image(1200, 630, 'png');
    const store = memoryStore();

    await uploadEyecatchImage('https://a.test/og', {
      folder: 'f',
      store,
      dryRun: false,
      fetcher: fetcherOf({ 'https://a.test/og': { buffer, contentType: 'application/octet-stream' } }),
    });

    expect(store.put).toHaveBeenCalledWith(contentKey('f', buffer, 'png'), buffer, 'image/png');
  });

  it('本文の画像から作るとき (derive) は、縮めて上端の片だけを JPEG にする', async () => {
    const store = memoryStore();

    const result = await uploadEyecatchImage('https://a.test/tall.png', {
      folder: 'f',
      store,
      dryRun: false,
      fetcher: fetcherOf({ 'https://a.test/tall.png': { buffer: await image(2000, 12500) } }),
      derive: CONFIG.upload,
    });

    expect(result).toMatchObject({ width: 1600, height: 4800, uploaded: true });
    expect(store.puts[0]).toMatch(/\.jpg$/);
    expect(store.put).toHaveBeenCalledWith(store.puts[0], expect.any(Buffer), 'image/jpeg');
  });

  it('画像でなければ例外', async () => {
    await expect(
      uploadEyecatchImage('https://a.test/og', {
        folder: 'f',
        store: memoryStore(),
        dryRun: false,
        fetcher: fetcherOf({ 'https://a.test/og': { buffer: Buffer.from('<html>') } }),
      })
    ).rejects.toThrow();
  });
});

describe('r2ImageStore', () => {
  it('R2StorageService の存在確認・アップロード (キーを指定)・公開 URL につなぐ', async () => {
    const r2 = {
      objectExists: jest.fn(async () => true),
      uploadImage: jest.fn(async () => ({})),
      publicUrlFor: jest.fn((key: string) => `https://images.example.com/${key}`),
    };
    const store = r2ImageStore(r2);

    await expect(store.exists('f/a.webp')).resolves.toBe(true);
    await store.put('f/a.webp', Buffer.from('x'), 'image/webp');
    expect(r2.uploadImage).toHaveBeenCalledWith(Buffer.from('x'), {
      filename: 'a.webp',
      contentType: 'image/webp',
      customKey: 'f/a.webp',
    });
    expect(store.publicUrlFor('f/a.webp')).toBe('https://images.example.com/f/a.webp');
  });
});
