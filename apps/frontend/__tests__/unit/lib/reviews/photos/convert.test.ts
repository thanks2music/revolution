/**
 * @jest-environment node
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { MAX_REVIEW_PHOTO_BYTES } from '@revolution/schemas/review-photo';

import {
  convertReviewPhoto,
  detectReviewPhotoFormat,
  variantWidthsFor,
  type ConvertedReviewPhoto,
} from '@/lib/reviews/photos/convert';

/**
 * 口コミの写真の変換 (one-more-time #163)。本物の sharp と libheif (WebAssembly) を使う。
 * 写真は、HEIC だけ macOS の sips で作った物を置き、ほかはテストの中で sharp で作る。
 */

const FIXTURES = path.join(__dirname, '../../../../fixtures/photos');

function expectConverted(
  result: Awaited<ReturnType<typeof convertReviewPhoto>>
): ConvertedReviewPhoto {
  if (!result.ok) throw new Error(`converted failed: ${result.reason}`);
  return result;
}

/** 位置情報と向き (右に 90 度回して見る写真) を持つ、横 1600 x 縦 1200 の JPEG */
async function jpegWithGpsAndOrientation(): Promise<Buffer> {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#3c8' } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'TestCam' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '35/1 41/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '139/1 46/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

/** EXIF に GPS の IFD への印 (タグ 0x8825) があるか。バイトの並びは両方を見る */
function hasGpsIfd(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  return exif.includes(Buffer.from([0x25, 0x88])) || exif.includes(Buffer.from([0x88, 0x25]));
}

describe('形式を中身で見分ける', () => {
  it('JPEG・PNG・HEIC を見分け、ほかは null', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .webp()
      .toBuffer();
    const heic = await readFile(path.join(FIXTURES, 'landscape-800x600.heic'));

    expect(detectReviewPhotoFormat(jpeg)).toBe('jpeg');
    expect(detectReviewPhotoFormat(png)).toBe('png');
    expect(detectReviewPhotoFormat(heic)).toBe('heic');
    expect(detectReviewPhotoFormat(gif)).toBeNull();
    expect(detectReviewPhotoFormat(webp)).toBeNull();
    expect(detectReviewPhotoFormat(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('表示用の段', () => {
  it('元より大きい段は作らない。1440 に届かない写真は元の幅を一番上の段にする', () => {
    expect(variantWidthsFor(4032)).toEqual([320, 720, 1440]);
    expect(variantWidthsFor(1000)).toEqual([320, 720, 1000]);
    expect(variantWidthsFor(720)).toEqual([320, 720]);
    expect(variantWidthsFor(500)).toEqual([320, 500]);
    expect(variantWidthsFor(200)).toEqual([200]);
  });
});

describe('写真の変換', () => {
  it('位置情報と向きのある JPEG: 向きを直し、メタデータを残さない', async () => {
    const input = await jpegWithGpsAndOrientation();
    // 前提: 入力に向きの印と位置情報がある
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(hasGpsIfd(before.exif)).toBe(true);

    const result = expectConverted(await convertReviewPhoto(input));

    // 横 1600 x 縦 1200 を右に 90 度回すと縦長になる。幅 1200 < 1440 なので縮めず、元の幅を一番上の段にする
    expect(result).toMatchObject({ width: 1200, height: 1600, variantWidths: [320, 720, 1200] });
    for (const variant of result.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe(variant.format === 'webp' ? 'webp' : 'heif');
      expect(meta.width).toBe(variant.width);
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
    expect(result.variants.map(v => `${v.width}.${v.format}`)).toEqual([
      '320.webp',
      '320.avif',
      '720.webp',
      '720.avif',
      '1200.webp',
      '1200.avif',
    ]);
  });

  it('HEIC を libheif で読み、WebP と AVIF にする', async () => {
    const input = await readFile(path.join(FIXTURES, 'landscape-800x600.heic'));

    const result = expectConverted(await convertReviewPhoto(input));

    expect(result).toMatchObject({ width: 800, height: 600, variantWidths: [320, 720, 800] });
    const largest = await sharp(
      result.variants.find(v => v.width === 720 && v.format === 'webp')!.body
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(largest.info).toMatchObject({ width: 720, height: 540 });
    // 左端は赤 (元の写真の左 1/4)、右側は青。色が保たれている
    const pixel = (x: number) =>
      Array.from(
        largest.data.subarray(
          (x + 270 * 720) * largest.info.channels,
          (x + 270 * 720) * largest.info.channels + 3
        )
      );
    expect(pixel(20)[0]).toBeGreaterThan(200);
    expect(pixel(600)[2]).toBeGreaterThan(200);
  });

  it('大きな写真は幅 1440 まで縮め、3 段を作る', async () => {
    const input = await sharp({
      create: { width: 4032, height: 3024, channels: 3, background: '#888' },
    })
      .png()
      .toBuffer();

    const result = expectConverted(await convertReviewPhoto(input));

    expect(result).toMatchObject({ width: 1440, height: 1080, variantWidths: [320, 720, 1440] });
    expect(result.variants).toHaveLength(6);
  });

  it('10MB を超える写真は、読まずに断る', async () => {
    const input = Buffer.alloc(MAX_REVIEW_PHOTO_BYTES + 1);
    input.set([0xff, 0xd8, 0xff]);
    await expect(convertReviewPhoto(input)).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('JPEG・PNG・HEIC でない物は断る。見分けた形式でも壊れていれば「読めない」', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    await expect(convertReviewPhoto(gif)).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(convertReviewPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const brokenHeic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(32),
    ]);
    await expect(convertReviewPhoto(brokenHeic)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});
