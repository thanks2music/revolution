/**
 * Layer 2: 記事の画像の取得・加工・R2 へのアップロード (`upload-article-images.ts`、2026-10-13)。
 * 取得 (fetcher) と R2 (store) は差し替え、画像は sharp でその場で作る。
 */
import sharp from 'sharp';
import type { ImageExtractionConfig } from '@/lib/types/subpage-detection';
import {
  contentKey,
  folderWriter,
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
    listKeys: jest.fn(async (prefix: string) => [...keys].filter((key) => key.startsWith(prefix))),
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

describe('folderWriter', () => {
  it('既にあるキーは一覧で 1 回だけ読み、上げない。新しいキーだけ上げる', async () => {
    const existingKey = contentKey('f', Buffer.from('old'), 'webp');
    const store = memoryStore([existingKey, 'other/x.webp']);
    const writer = folderWriter(store, 'f');

    const old = await writer.put(Buffer.from('old'), 'webp', 'image/webp');
    const fresh = await writer.put(Buffer.from('new'), 'webp', 'image/webp');
    const again = await writer.put(Buffer.from('new'), 'webp', 'image/webp');

    expect(store.listKeys).toHaveBeenCalledTimes(1);
    expect(store.listKeys).toHaveBeenCalledWith('f/');
    expect([old.uploaded, fresh.uploaded, again.uploaded]).toEqual([false, true, false]);
    expect(store.puts).toEqual([contentKey('f', Buffer.from('new'), 'webp')]);
    expect(old.url).toBe(`https://images.example.com/${existingKey}`);
  });

  it('同じ中身を並列に上げても、R2 に置くのは 1 回 (同じ画像の中の同じ片など)', async () => {
    const store = memoryStore();
    const writer = folderWriter(store, 'f');

    const results = await Promise.all([1, 2, 3].map(() => writer.put(Buffer.from('same'), 'webp', 'image/webp')));

    expect(store.put).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.uploaded)).toHaveLength(1);
    expect(new Set(results.map((result) => result.url)).size).toBe(1);
  });

  it('一覧の取得に失敗したら、その書き込みは失敗し、次の書き込みで一覧を取り直す', async () => {
    const store = memoryStore();
    (store.listKeys as jest.Mock).mockRejectedValueOnce(new Error('R2 unavailable'));
    const writer = folderWriter(store, 'f');

    await expect(writer.put(Buffer.from('a'), 'webp', 'image/webp')).rejects.toThrow('R2 unavailable');
    await expect(writer.put(Buffer.from('a'), 'webp', 'image/webp')).resolves.toMatchObject({ uploaded: true });
    expect(store.listKeys).toHaveBeenCalledTimes(2);
  });

  it('store が null なら dry-run (R2 に触らず、URL を [DRY RUN] にする)', async () => {
    const result = await folderWriter(null, 'f').put(Buffer.from('a'), 'webp', 'image/webp');
    expect(result).toEqual({ url: expect.stringMatching(/^\[DRY RUN\] .*\/f\/[0-9a-f]{32}\.webp$/), uploaded: false });
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
      { writer: folderWriter(store, 'cafe/2026/X'), config: CONFIG, fetcher }
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
    const fetcher = fetcherOf({ 'https://a.test/1.png': { buffer: await image(800, 600) } });
    const first = memoryStore();
    await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      writer: folderWriter(first, 'f'),
      config: CONFIG,
      fetcher,
    });

    const second = memoryStore(first.puts);
    const result = await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      writer: folderWriter(second, 'f'),
      config: CONFIG,
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
      { writer: folderWriter(memoryStore(), 'f'), config: CONFIG, fetcher }
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
      writer: folderWriter(memoryStore(), 'f'),
      config: CONFIG,
      fetcher,
    });

    expect(result.uploaded[0].segments.map((s) => s.height)).toEqual([4800, 1200]);
    expect(result.newObjects).toBe(2);
  });

  it('dry-run でも加工はするので、寸法は本物', async () => {
    const fetcher = fetcherOf({ 'https://a.test/1.png': { buffer: await image(800, 600) } });

    const result = await uploadArticleImages([{ url: 'https://a.test/1.png', alt: null }], {
      writer: folderWriter(null, 'f'),
      config: CONFIG,
      fetcher,
    });

    expect(result.uploaded[0].segments[0]).toMatchObject({ url: expect.stringMatching(/^\[DRY RUN\] /), width: 800, height: 600 });
    expect(result.newObjects).toBe(0);
  });
});

describe('uploadEyecatchImage', () => {
  it('og:image は形式を変えずに上げ (SNS で読めるように)、寸法を測る。拡張子は中身の形式で決める', async () => {
    const buffer = await image(1200, 630, 'jpeg');
    const store = memoryStore();

    const result = await uploadEyecatchImage('https://a.test/og', {
      writer: folderWriter(store, 'f'),
      config: CONFIG.upload,
      fetcher: fetcherOf({ 'https://a.test/og': { buffer, contentType: 'application/octet-stream' } }),
    });

    expect(result).toEqual({ url: `https://images.example.com/${store.puts[0]}`, width: 1200, height: 630, uploaded: true });
    expect(store.put).toHaveBeenCalledWith(contentKey('f', buffer, 'jpg'), buffer, 'image/jpeg');
  });

  it('og:image でも SVG (許可した形式以外) や max_bytes を超えるものは、作り直して JPEG にする', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="red"/></svg>');
    const big = await image(1200, 630, 'png');
    const store = memoryStore();
    const fetcher = fetcherOf({ 'https://a.test/og.svg': { buffer: svg }, 'https://a.test/og.png': { buffer: big } });

    const fromSvg = await uploadEyecatchImage('https://a.test/og.svg', { writer: folderWriter(store, 'f'), config: CONFIG.upload, fetcher });
    const fromBig = await uploadEyecatchImage('https://a.test/og.png', {
      writer: folderWriter(store, 'f'),
      config: { ...CONFIG.upload, max_bytes: 100 },
      fetcher,
    });

    expect(fromSvg).toMatchObject({ width: 1200, height: 630 });
    expect(store.puts.every((key) => key.endsWith('.jpg'))).toBe(true);
    expect(fromBig.url).toMatch(/\.jpg$/);
    expect(store.put).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'image/svg+xml');
  });

  it('本文の画像から作るとき (fromBody) は、縮めて上端の片だけを JPEG にする', async () => {
    const store = memoryStore();

    const result = await uploadEyecatchImage('https://a.test/tall.png', {
      writer: folderWriter(store, 'f'),
      fetcher: fetcherOf({ 'https://a.test/tall.png': { buffer: await image(2000, 12500) } }),
      config: CONFIG.upload,
      fromBody: true,
    });

    expect(result).toMatchObject({ width: 1600, height: 4800, uploaded: true });
    expect(store.puts[0]).toMatch(/\.jpg$/);
    expect(store.put).toHaveBeenCalledWith(store.puts[0], expect.any(Buffer), 'image/jpeg');
  });

  it('画像でなければ例外', async () => {
    await expect(
      uploadEyecatchImage('https://a.test/og', {
        writer: folderWriter(memoryStore(), 'f'),
        config: CONFIG.upload,
        fetcher: fetcherOf({ 'https://a.test/og': { buffer: Buffer.from('<html>') } }),
      })
    ).rejects.toThrow();
  });
});

describe('r2ImageStore', () => {
  it('R2StorageService の一覧・アップロード (キーを指定)・公開 URL につなぐ', async () => {
    const r2 = {
      listAllObjects: jest.fn(async () => ['f/a.webp']),
      uploadImage: jest.fn(async () => ({})),
      getPublicUrl: jest.fn((key: string) => `https://images.example.com/${key}`),
    };
    const store = r2ImageStore(r2);

    await expect(store.listKeys('f/')).resolves.toEqual(['f/a.webp']);
    expect(r2.listAllObjects).toHaveBeenCalledWith('f/');
    await store.put('f/a.webp', Buffer.from('x'), 'image/webp');
    expect(r2.uploadImage).toHaveBeenCalledWith(Buffer.from('x'), {
      filename: 'a.webp',
      contentType: 'image/webp',
      customKey: 'f/a.webp',
    });
    expect(store.publicUrlFor('f/a.webp')).toBe('https://images.example.com/f/a.webp');
  });
});
