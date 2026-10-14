/**
 * 記事の画像を R2 に上げる前に加工する (2026-10-13 BOSS 決定)
 *
 * - 短辺が `min_short_side` 未満の画像は載せない (アイコン・見出しの帯など。枚数の上限は設けない)
 * - 幅が `max_width` を超える画像は縮める (縦横比は保つ)
 * - WebP にする。`max_bytes` を超えたら品質を下げる
 * - 高さが幅の `split_ratio` 倍を超える縦長の画像は、上から順に高さ `segment_height` で分割する
 *   (ヒロアカのメニュー画像は 1920×28300。1 枚のままだと WebP の 1 辺の上限 16,383px を超え、記事でも重い)
 *
 * 見る人には Next.js が AVIF / WebP に変換して届けるので、ここで WebP にするのは R2 の容量と 5 MB の上限のため。
 * 設定は Templates の `config/store-url-patterns.yaml` の `image_extraction` (YAML が SoT)。
 */
import sharp from 'sharp';
import type { ImageUploadConfig } from '@/lib/types/subpage-detection';
import { MAX_INPUT_PIXELS } from '@/lib/services/vision-api/prepare-vision-images';

export interface ProcessedSegment {
  buffer: Buffer;
  width: number;
  height: number;
}

export type ProcessedImage =
  | { kind: 'ok'; width: number; height: number; segments: ProcessedSegment[] }
  | { kind: 'too_small'; width: number; height: number };

/** 分割の位置 (縮めた後の座標)。高さが幅の ratio 倍以下なら 1 片。最後の片は残りの高さ */
export function planSegments(
  width: number,
  height: number,
  config: Pick<ImageUploadConfig, 'split_ratio' | 'segment_height'>
): Array<{ top: number; height: number }> {
  if (width <= 0 || height <= width * config.split_ratio) return [{ top: 0, height }];
  const segments: Array<{ top: number; height: number }> = [];
  for (let top = 0; top < height; top += config.segment_height) {
    segments.push({ top, height: Math.min(config.segment_height, height - top) });
  }
  return segments;
}

/** 縮めた後の寸法 (幅が max_width を超えるときだけ縮める) */
export function resizedSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

/**
 * 読み込む画像。EXIF の向きを反映し (反映しないと縦の写真が横倒しになる)、画素数の上限を付ける
 * (悪意のある巨大な画像で止まらないため。上限は Vision の下準備と共通)
 */
function loadImage(buffer: Buffer): sharp.Sharp {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true, animated: false });
}

/**
 * 向きを反映した後の寸法と形式。metadata() はヘッダーしか読まず limitInputPixels で止まらないため、
 * 展開の前にここで画素数を確かめる
 *
 * @throws 画像として読めないとき・画素数が大きすぎるとき
 */
export async function readImageInfo(buffer: Buffer): Promise<{ width: number; height: number; format: string }> {
  const metadata = await loadImage(buffer).metadata();
  const { width, height } = metadata.autoOrient ?? metadata;
  if (!width || !height || !metadata.format) throw new Error('画像の大きさを読めない');
  if (width * height > MAX_INPUT_PIXELS) throw new Error(`画像が大きすぎる (${width}×${height})`);
  // sharp は AVIF も HEIC も heif と報告する。ブラウザで読めない HEIC を AVIF と取り違えないよう分ける
  const format = metadata.format === 'heif' && metadata.compression !== 'av1' ? 'heic' : metadata.format;
  return { width, height, format };
}

/**
 * max_width まで縮めて一度だけ展開し (無圧縮の画素)、分割の片を切り出せる形にする。分割の座標は、
 * 縮めた後の実際の寸法で決める (計算の丸めで 1px ずれると extract が失敗するため)
 */
async function decodeResized(buffer: Buffer, source: { width: number; height: number }, config: ImageUploadConfig) {
  const size = resizedSize(source.width, source.height, config.max_width);
  const { data, info } = await loadImage(buffer)
    .resize({ width: size.width, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  return {
    width: info.width,
    segments: planSegments(info.width, info.height, config),
    /** 片を切り出す (品質を下げて作り直すたびに呼ぶ。sharp の clone は jsdom の Jest で動かないため使わない) */
    extract: (segment: { top: number; height: number }) => () =>
      sharp(data, { raw, limitInputPixels: MAX_INPUT_PIXELS }).extract({
        left: 0,
        top: segment.top,
        width: info.width,
        height: segment.height,
      }),
  };
}

/**
 * WebP (既定) か JPEG にする。max_bytes を超えたら品質を下げる (min_quality で止め、それでも超えればそのまま返す)。
 * 品質の段階は WebP と同じ値を使う
 */
async function encode(input: () => sharp.Sharp, config: ImageUploadConfig, format: 'webp' | 'jpeg' = 'webp'): Promise<Buffer> {
  let quality = config.webp_quality;
  for (;;) {
    const buffer = await (format === 'webp' ? input().webp({ quality }) : input().jpeg({ quality, mozjpeg: true })).toBuffer();
    if (buffer.length <= config.max_bytes || quality <= config.webp_min_quality) return buffer;
    quality = Math.max(config.webp_min_quality, quality - config.quality_step);
  }
}

/**
 * 取得した 1 枚を加工する (縮小・分割・WebP)。
 *
 * @throws 画像として読めないとき・画素数が大きすぎるとき
 */
export async function processArticleImage(
  buffer: Buffer,
  config: ImageUploadConfig,
  minShortSide: number
): Promise<ProcessedImage> {
  const source = await readImageInfo(buffer);
  if (Math.min(source.width, source.height) < minShortSide) return { kind: 'too_small', ...pick(source) };

  const decoded = await decodeResized(buffer, source, config);
  const segments: ProcessedSegment[] = [];
  for (const segment of decoded.segments) {
    segments.push({ buffer: await encode(decoded.extract(segment), config), width: decoded.width, height: segment.height });
  }
  return { kind: 'ok', ...pick(source), segments };
}

/**
 * og:image が無いときに、本文の画像から作るアイキャッチ (記事の冒頭と SNS の共有画像)。
 * 幅は max_width まで縮め、縦長の画像は分割の最初の片の範囲 (上端から) だけを使い、SNS で読める JPEG にする
 *
 * @throws 画像として読めないとき・画素数が大きすぎるとき
 */
export async function processEyecatchFallback(buffer: Buffer, config: ImageUploadConfig): Promise<ProcessedSegment> {
  const decoded = await decodeResized(buffer, await readImageInfo(buffer), config);
  const top = decoded.segments[0];
  return { buffer: await encode(decoded.extract(top), config, 'jpeg'), width: decoded.width, height: top.height };
}

function pick({ width, height }: { width: number; height: number }) {
  return { width, height };
}
