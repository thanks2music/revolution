/**
 * Layer 1: 記事の画像の加工 (`process-article-image.ts`、2026-10-13)。
 * 画像は sharp でその場で作る (外部の画像を取りに行かない)。
 */
import sharp from 'sharp';
import type { ImageUploadConfig } from '@/lib/types/subpage-detection';
import { planSegments, processArticleImage, processEyecatchFallback, resizedSize } from '@/lib/services/article-images/process-article-image';

/** Templates の config/store-url-patterns.yaml の image_extraction.upload と同じ値 */
const CONFIG: ImageUploadConfig = {
  max_width: 1600,
  webp_quality: 85,
  webp_min_quality: 50,
  quality_step: 10,
  max_bytes: 5 * 1024 * 1024,
  split_ratio: 3,
  segment_height: 4800,
};

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

describe('planSegments', () => {
  it('高さが幅の split_ratio 倍以下なら 1 片', () => {
    expect(planSegments(1000, 3000, CONFIG)).toEqual([{ top: 0, height: 3000 }]);
  });

  it('超えれば segment_height ごとに分け、最後の片は残りの高さ', () => {
    expect(planSegments(1600, 10000, CONFIG)).toEqual([
      { top: 0, height: 4800 },
      { top: 4800, height: 4800 },
      { top: 9600, height: 400 },
    ]);
  });
});

describe('resizedSize', () => {
  it('幅が max_width 以下ならそのまま、超えれば縦横比を保って縮める', () => {
    expect(resizedSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(resizedSize(1920, 28300, 1600)).toEqual({ width: 1600, height: 23583 });
  });
});

describe('processArticleImage', () => {
  it('短辺が下限未満なら too_small (アイコンなど)', async () => {
    const result = await processArticleImage(await png(400, 120), CONFIG, 300);
    expect(result).toEqual({ kind: 'too_small', width: 400, height: 120 });
  });

  it('幅の大きい画像は max_width に縮め、WebP にする', async () => {
    const result = await processArticleImage(await png(2400, 1200), CONFIG, 300);
    if (result.kind !== 'ok') throw new Error('ok のはず');

    expect(result).toMatchObject({ width: 2400, height: 1200 });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ width: 1600, height: 800 });
    expect((await sharp(result.segments[0].buffer).metadata()).format).toBe('webp');
  });

  it('縦長の画像は、縮めた後の座標で分割する (片の高さの合計は縮めた後の高さ)', async () => {
    // 2000×12500 → 1600×10000 → 4800 + 4800 + 400
    const result = await processArticleImage(await png(2000, 12500), CONFIG, 300);
    if (result.kind !== 'ok') throw new Error('ok のはず');

    expect(result.segments.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1600, height: 4800 },
      { width: 1600, height: 4800 },
      { width: 1600, height: 400 },
    ]);
    const metadata = await Promise.all(result.segments.map((s) => sharp(s.buffer).metadata()));
    expect(metadata.map((m) => [m.width, m.height])).toEqual(result.segments.map((s) => [s.width, s.height]));
  });

  it('max_bytes を超えたら品質を下げ、下限で止める', async () => {
    const noisy = await sharp(Buffer.from(Array.from({ length: 600 * 600 * 3 }, (_, i) => (i * 7919) % 251)), {
      raw: { width: 600, height: 600, channels: 3 },
    })
      .png()
      .toBuffer();
    const high = await processArticleImage(noisy, { ...CONFIG, max_bytes: Number.MAX_SAFE_INTEGER }, 300);
    const low = await processArticleImage(noisy, { ...CONFIG, max_bytes: 1 }, 300);
    if (high.kind !== 'ok' || low.kind !== 'ok') throw new Error('ok のはず');

    expect(low.segments[0].buffer.length).toBeLessThan(high.segments[0].buffer.length);
  });

  it('画像として読めなければ例外', async () => {
    await expect(processArticleImage(Buffer.from('not an image'), CONFIG, 300)).rejects.toThrow();
  });
});

describe('processEyecatchFallback', () => {
  it('透過のある画像は白で塗ってから JPEG にする (黒い背景にしない)', async () => {
    const transparent = await sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();

    const result = await processEyecatchFallback(transparent, CONFIG);
    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });

    expect((await sharp(result.buffer).metadata()).format).toBe('jpeg');
    expect([data[0], data[1], data[2]].every((value) => value > 240)).toBe(true);
  });
});
