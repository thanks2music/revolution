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

/** 展開する画素数の上限 (Vision の下準備と同じ。悪意のある巨大な画像で止まらないため) */
const MAX_INPUT_PIXELS = 100_000_000;

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

/** WebP にする。max_bytes を超えたら品質を下げる (min_quality で止め、それでも超えればそのまま返す) */
async function encodeWebp(input: () => sharp.Sharp, config: ImageUploadConfig): Promise<Buffer> {
  let quality = config.webp_quality;
  for (;;) {
    const buffer = await input().webp({ quality }).toBuffer();
    if (buffer.length <= config.max_bytes || quality <= config.webp_min_quality) return buffer;
    quality = Math.max(config.webp_min_quality, quality - config.quality_step);
  }
}

/**
 * 取得した 1 枚を加工する。EXIF の向きを反映してから測る (反映しないと縦の写真が横倒しになる)。
 *
 * @throws 画像として読めないとき・画素数が大きすぎるとき
 */
export async function processArticleImage(
  buffer: Buffer,
  config: ImageUploadConfig,
  minShortSide: number
): Promise<ProcessedImage> {
  const load = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true, animated: false });
  const metadata = await load().metadata();
  const { width, height } = metadata.autoOrient ?? metadata;
  if (!width || !height) throw new Error('画像の大きさを読めない');
  // metadata() はヘッダーしか読まず limitInputPixels で止まらないため、展開の前にここで止める
  if (width * height > MAX_INPUT_PIXELS) throw new Error(`画像が大きすぎる (${width}×${height})`);
  if (Math.min(width, height) < minShortSide) return { kind: 'too_small', width, height };

  const size = resizedSize(width, height, config.max_width);
  // 縮めた画像を一度だけ展開し (無圧縮の画素)、分割はそこから切り出す (分割の座標は縮めた後のもの)
  const { data, info } = await load()
    .resize({ width: size.width, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const segments: ProcessedSegment[] = [];
  for (const segment of planSegments(info.width, info.height, config)) {
    // 品質を下げて作り直すたびに、同じ片を切り出し直す (sharp の clone は jsdom の Jest で動かないため使わない)
    const input = () =>
      sharp(data, { raw, limitInputPixels: MAX_INPUT_PIXELS }).extract({
        left: 0,
        top: segment.top,
        width: info.width,
        height: segment.height,
      });
    segments.push({ buffer: await encodeWebp(input, config), width: info.width, height: segment.height });
  }
  return { kind: 'ok', width, height, segments };
}
