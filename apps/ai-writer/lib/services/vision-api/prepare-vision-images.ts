/**
 * Vision に渡す画像を用意する (取得は Layer 2、分割の計画は Layer 1)。
 *
 * 縦に長い画像 (1 枚に全品を並べたメニュー表など) をそのまま渡すと、1 枚あたりのトークンの上限に
 * 合わせて大きく縮められ、小さな文字を読み違える。2026-10-12 のヒロアカ (1920×19,600 と
 * 1920×28,300 の 2 枚) では、Gemini の LOW で 26 品中 1〜4 品の品名を読み違えた
 * (例: 「てりマヨチキン」→「テリヤキチキン」)。確信度は 0.93〜0.95 のままで、確信度では防げない。
 *
 * そこで、縦に長い画像は「高さ ≤ 幅 × {@link MAX_SLICE_ASPECT}」の区切りに分け、境目で品名が
 * 切れないよう {@link SLICE_OVERLAP_RATIO} だけ重ねて切り出す。長辺は {@link MAX_LONG_EDGE} まで
 * 縮める。3 社とも、ここで用意した同じ画像 (base64) を受け取る (2026-10-12 の方針)。
 *
 * 重なりの部分は 2 回読まれるので、同じ品目が 2 回返ることがある。重複は
 * `normalizeVisionResponse` が除く。
 *
 * - Gemini の画像のトークン: 公式の media resolution の表 (LOW 280 / HIGH 1,120 per image)
 *   https://ai.google.dev/gemini-api/docs/media-resolution
 * - Claude の推奨の長辺 1,568px: https://platform.claude.com/docs/en/build-with-claude/vision
 */
import sharp from 'sharp';
import { fetchImageSafely } from '@/lib/utils/safe-image-fetch';
import { assertHttpImageUrls } from '@/lib/utils/vision-api-utils';
import type { VisionImage } from '@/lib/types/vision-api';

/** 1 片の高さの上限 (幅に対する比) */
export const MAX_SLICE_ASPECT = 1.5;

/** 隣の片と重ねる割合 (片の高さに対する比)。境目で品名が切れないように */
export const SLICE_OVERLAP_RATIO = 0.1;

/** 1 枚から切り出す片の上限。超えるときは片を高くして収める */
export const MAX_SLICES_PER_IMAGE = 20;

/** 長辺の上限 (px)。Claude の推奨に合わせる。Gemini の HIGH もこの大きさで足りる */
export const MAX_LONG_EDGE = 1568;

/**
 * 読む画像の画素数の上限。sharp の既定 (約 2.7 億画素) のままだと、小さなファイルが巨大な画像に
 * 展開されてメモリを使い切りうる (解凍爆弾)。実在するメニュー表 (1920×28,300 = 約 5,400 万画素) の
 * 倍程度に抑える。画素数はヘッダーだけを読む `metadata()` で先に確かめる
 */
export const MAX_INPUT_PIXELS = 100_000_000;

/** 1 回のリクエストで渡す片の上限 (1 カテゴリあたり)。Claude は 1 リクエスト 100 枚・32MB まで */
export const MAX_IMAGES_PER_REQUEST = 40;

const IMAGE_FETCH_TIMEOUT_MS = 15000;
const JPEG_QUALITY = 85;

export interface SliceRect {
  top: number;
  height: number;
}

/**
 * 縦に長い画像の切り出し位置を決める。幅に対して高さが {@link MAX_SLICE_ASPECT} 以下なら 1 片。
 * 最後の片は画像の下端に揃える (端が細い片にならないように)。
 */
export function planSlices(width: number, height: number): SliceRect[] {
  let sliceHeight = Math.floor(width * MAX_SLICE_ASPECT);
  if (width <= 0 || height <= sliceHeight) return [{ top: 0, height }];

  // 片の数 n は、step = sliceHeight × (1 − overlap) として sliceHeight + (n − 1) × step ≥ height
  const countFor = (h: number) => 1 + Math.ceil((height - h) / Math.floor(h * (1 - SLICE_OVERLAP_RATIO)));
  if (countFor(sliceHeight) > MAX_SLICES_PER_IMAGE) {
    sliceHeight = Math.ceil(
      height / (1 + (MAX_SLICES_PER_IMAGE - 1) * (1 - SLICE_OVERLAP_RATIO))
    );
    while (countFor(sliceHeight) > MAX_SLICES_PER_IMAGE) sliceHeight++;
  }

  const step = Math.floor(sliceHeight * (1 - SLICE_OVERLAP_RATIO));
  const slices: SliceRect[] = [];
  for (let top = 0; ; top += step) {
    if (top + sliceHeight >= height) {
      slices.push({ top: height - sliceHeight, height: sliceHeight });
      break;
    }
    slices.push({ top, height: sliceHeight });
  }
  return slices;
}

async function toJpeg(input: sharp.Sharp): Promise<string> {
  const buffer = await input
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return buffer.toString('base64');
}

/**
 * 取得した 1 枚を、分割・縮小した JPEG にする。
 * EXIF の向き (Orientation) を反映してから扱う (sharp は既定では向きを反映せず、再エンコードで EXIF も落とす。
 * 反映しないと、縦に撮った写真が横倒しのまま渡る)。
 */
export async function splitImage(buffer: Buffer, source: string): Promise<VisionImage[]> {
  const load = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
  const metadata = await load().metadata();
  const { width, height } = metadata.autoOrient ?? metadata;
  if (!width || !height) throw new Error('画像の大きさを読めない');
  // metadata() はヘッダーしか読まず limitInputPixels で止まらないため、展開の前にここで止める (消さないこと)
  if (width * height > MAX_INPUT_PIXELS) {
    throw new Error(`画像が大きすぎる (${width}×${height})`);
  }

  const slices = planSlices(width, height);
  if (slices.length === 1) {
    return [{ source, data: await toJpeg(load()), mimeType: 'image/jpeg' }];
  }
  const images: VisionImage[] = [];
  for (const [index, slice] of slices.entries()) {
    const data = await toJpeg(load().extract({ left: 0, top: slice.top, width, height: slice.height }));
    images.push({ source: `${source}#slice=${index + 1}/${slices.length}`, data, mimeType: 'image/jpeg' });
  }
  return images;
}

export type ImageFetcher = (url: string) => Promise<Buffer>;

const fetchImage: ImageFetcher = async (url) =>
  (await fetchImageSafely(url, { timeoutMs: IMAGE_FETCH_TIMEOUT_MS })).buffer;

/**
 * 画像を取得し、分割・縮小して返す。
 *
 * 取得や読み込みに失敗した画像は警告して除く (1 枚の失敗でカテゴリ全体を止めない)。1 枚ずつ順に処理する
 * (縦に長い画像は展開すると数百 MB になるため、並列にしない)。
 *
 * @throws {Error} URL が http(s) でないとき (SSRF の防御。取得の前に止める)
 */
export async function prepareVisionImages(
  imageUrls: string[],
  fetcher: ImageFetcher = fetchImage
): Promise<VisionImage[]> {
  assertHttpImageUrls(imageUrls);
  const images: VisionImage[] = [];
  for (const url of imageUrls) {
    if (images.length >= MAX_IMAGES_PER_REQUEST) {
      console.warn(`[prepareVisionImages] ⚠️ 片が上限 (${MAX_IMAGES_PER_REQUEST}) に達したため、残りの画像を読まない: ${url}`);
      break;
    }
    try {
      const pieces = await splitImage(await fetcher(url), url);
      images.push(...pieces.slice(0, MAX_IMAGES_PER_REQUEST - images.length));
    } catch (error) {
      console.warn(
        `[prepareVisionImages] ⚠️ 画像を使えない (${error instanceof Error ? error.message : String(error)}): ${url}`
      );
    }
  }
  const sliced = images.length - imageUrls.length;
  console.log(
    `[prepareVisionImages] ${imageUrls.length} 枚 → ${images.length} 片${sliced > 0 ? ` (縦に長い画像を分割)` : ''}`
  );
  return images;
}
