/**
 * @jest-environment node
 */
/**
 * Layer 1 / 2 tests for `prepare-vision-images.ts`.
 *
 * - Layer 1: 縦に長い画像の切り出し位置 (`planSlices`)
 * - Layer 2: sharp で実際に分割・縮小する (`splitImage`)、取得の失敗と URL の検査 (`prepareVisionImages`)
 *
 * 2026-10-12、ヒロアカの 1920×28,300 のメニュー表を 1 枚のまま渡して品名を読み違えたことが発端。
 */
import zlib from 'node:zlib';
import sharp from 'sharp';
import {
  MAX_IMAGES_PER_REQUEST,
  MAX_INPUT_PIXELS,
  MAX_LONG_EDGE,
  MAX_SLICE_ASPECT,
  MAX_SLICES_PER_IMAGE,
  SLICE_OVERLAP_RATIO,
  planSlices,
  prepareVisionImages,
  splitImage,
} from '@/lib/services/vision-api/prepare-vision-images';

async function solidImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg()
    .toBuffer();
}

describe('planSlices', () => {
  it('高さが幅 × 1.5 以下なら 1 片 (分割しない)', () => {
    expect(planSlices(1200, 1800)).toEqual([{ top: 0, height: 1800 }]);
    expect(planSlices(717, 1014)).toEqual([{ top: 0, height: 1014 }]);
  });

  it('縦に長い画像は、隣と重ねながら上から切り、最後の片は下端に揃える', () => {
    const slices = planSlices(1920, 28300);
    const sliceHeight = Math.floor(1920 * MAX_SLICE_ASPECT);

    expect(slices[0]).toEqual({ top: 0, height: sliceHeight });
    expect(slices.at(-1)).toEqual({ top: 28300 - sliceHeight, height: sliceHeight });
    // 隣の片と重なる (境目の品名が切れない)
    for (let i = 1; i < slices.length; i++) {
      const overlap = slices[i - 1].top + slices[i - 1].height - slices[i].top;
      expect(overlap).toBeGreaterThanOrEqual(Math.floor(sliceHeight * SLICE_OVERLAP_RATIO));
    }
    expect(slices).toHaveLength(11);
  });

  it('片が上限を超えるほど長い画像は、片を高くして上限に収める (隙間は作らない)', () => {
    const slices = planSlices(500, 100_000);

    expect(slices.length).toBeLessThanOrEqual(MAX_SLICES_PER_IMAGE);
    expect(slices[0].top).toBe(0);
    expect(slices.at(-1)!.top + slices.at(-1)!.height).toBe(100_000);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].top).toBeLessThan(slices[i - 1].top + slices[i - 1].height);
    }
  });
});

describe('splitImage', () => {
  it('縦に長い画像を JPEG の片にし、長辺を上限まで縮め、出所に片の番号を付ける', async () => {
    const images = await splitImage(await solidImage(1000, 6000), 'https://example.com/menu.jpg');

    expect(images.length).toBe(planSlices(1000, 6000).length);
    expect(images[0].source).toBe(`https://example.com/menu.jpg#slice=1/${images.length}`);
    for (const image of images) {
      expect(image.mimeType).toBe('image/jpeg');
      const { width, height } = await sharp(Buffer.from(image.data, 'base64')).metadata();
      expect(Math.max(width!, height!)).toBeLessThanOrEqual(MAX_LONG_EDGE);
    }
  });

  it('画素数が上限を超える画像は、展開する前に断る (解凍爆弾の防御)', async () => {
    // 1×1 の PNG のヘッダーを、上限を超える大きさに書き換える (中身は展開されない)
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
    const huge = Buffer.from(png);
    huge.writeUInt32BE(20_000, 16); // IHDR width
    huge.writeUInt32BE(20_000, 20); // IHDR height
    huge.writeUInt32BE(zlib.crc32(huge.subarray(12, 29)) >>> 0, 29); // IHDR の CRC を合わせる (壊れた PNG として断られないように)

    await expect(splitImage(huge, 'https://example.com/bomb.png')).rejects.toThrow(/pixel limit|大きすぎる/);
    expect(20_000 * 20_000).toBeGreaterThan(MAX_INPUT_PIXELS);
  });

  it('EXIF の向きを反映してから扱う (縦横を入れ替えて保存された写真を横倒しのまま分割しない)', async () => {
    // 保存は 200×1000 (縦長) だが、Orientation=6 なので表示は 1000×200 (横長) = 分割しない
    const stored = await sharp({ create: { width: 200, height: 1000, channels: 3, background: '#fff' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const images = await splitImage(stored, 'https://example.com/photo.jpg');

    expect(images).toHaveLength(1);
    const { width, height } = await sharp(Buffer.from(images[0].data, 'base64')).metadata();
    expect(width).toBeGreaterThan(height!);
  });

  it('分割しない画像は 1 片で、出所は元の URL のまま', async () => {
    const images = await splitImage(await solidImage(800, 600), 'https://example.com/goods.png');

    expect(images).toHaveLength(1);
    expect(images[0].source).toBe('https://example.com/goods.png');
    const { width } = await sharp(Buffer.from(images[0].data, 'base64')).metadata();
    expect(width).toBe(800); // 小さい画像は拡大しない
  });
});

describe('prepareVisionImages', () => {
  it('取得や読み込みに失敗した画像は除いて続ける', async () => {
    const ok = await solidImage(400, 300);
    const fetcher = jest.fn(async (url: string) => {
      if (url.includes('404')) throw new Error('HTTP 404');
      if (url.includes('broken')) return Buffer.from('not an image');
      return ok;
    });

    const images = await prepareVisionImages(
      ['https://example.com/a.jpg', 'https://example.com/404.jpg', 'https://example.com/broken.jpg'],
      fetcher
    );

    expect(images.map((image) => image.source)).toEqual(['https://example.com/a.jpg']);
  });

  it('1 回のリクエストに渡す片は上限まで (縦に長い画像が多くても API の上限を超えない)', async () => {
    const tall = await solidImage(400, 400 * 1.5 * 30); // 1 枚で上限 (20 片) まで分割される
    const images = await prepareVisionImages(
      ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
      async () => tall
    );

    expect(images).toHaveLength(MAX_IMAGES_PER_REQUEST);
  });

  it('http(s) 以外の URL は取得の前に弾く (SSRF の防御)', async () => {
    const fetcher = jest.fn();

    await expect(prepareVisionImages(['file:///etc/passwd'], fetcher)).rejects.toThrow(/scheme/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
