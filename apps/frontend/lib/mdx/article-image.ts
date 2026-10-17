/**
 * 記事の画像の表示と拡大表示のための純粋関数 (Layer 1)。
 *
 * - 本文の画像は「元の幅」と「記事の幅」の小さい方で、縦横比のまま出す (2026-10-13 BOSS 決定)
 * - 拡大表示 (yet-another-react-lightbox) と極端に縦長の画像は、`/_next/image` の URL を自前で組み立てる。
 *   変換できる幅・品質は next.config と同じ値 (lib/image-config.mjs) に限られる (それ以外は 400)
 */
import type { SlideImage } from 'yet-another-react-lightbox';
import { IMAGE_DEVICE_SIZES, IMAGE_QUALITIES, IMAGE_SIZES, R2_IMAGE_HOST } from '@/lib/image-config.mjs';

/** 記事の列の幅 (`styles/globals.css` の `--container-main: clamp(0px, 1050px, 90vw)` と同じ) */
export const ARTICLE_COLUMN_PX = 1050;
const ARTICLE_COLUMN_VW = 90;
const COLUMN_BREAKPOINT_PX = Math.ceil(ARTICLE_COLUMN_PX / (ARTICLE_COLUMN_VW / 100));

const OPTIMIZER_WIDTHS = [...IMAGE_SIZES, ...IMAGE_DEVICE_SIZES].sort((a, b) => a - b);
const OPTIMIZER_QUALITY = IMAGE_QUALITIES[0];

/**
 * 変換後の画像の 1 辺の上限。WebP は 16,383px (AVIF も同程度) で、超える変換版は作れず、
 * Next.js は元の画像をそのまま返す (2026-10-13 実測: 1920×28300 の JPEG で w=1200 以上が 7.3 MB の元画像になった)。
 * AI Writer が縦長の画像を分割して上げるようになれば、新しい記事では当たらない (既存の記事のための歯止め)
 */
const MAX_ENCODED_DIMENSION = 16383;

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * 縦横比を保って変換したときに、高さが上限に収まる最大の変換幅 (元の幅を超えない)。
 * 元の高さが上限以下なら、どの幅でも変換できるので null
 */
export function maxOptimizableWidth(width: number, height: number): number | null {
  if (height <= MAX_ENCODED_DIMENSION) return null;
  const fits = (w: number) => w <= width && Math.round((height / width) * w) <= MAX_ENCODED_DIMENSION;
  return OPTIMIZER_WIDTHS.filter(fits).at(-1) ?? OPTIMIZER_WIDTHS[0];
}

/** 自前の画像の配信元 (Cloudflare R2) の URL か */
export function isOwnImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && url.hostname === R2_IMAGE_HOST;
  } catch {
    return false;
  }
}

/**
 * 冒頭に出すアイキャッチか。自前の配信元の画像だけ (サイト共通の OG 画像や、
 * 変換を許していない配信元の URL は出さない。後者は /_next/image が 400 を返す)
 */
export function isArticleEyecatch(ogImage: string | null | undefined): ogImage is string {
  return typeof ogImage === 'string' && isOwnImageUrl(ogImage);
}

/** MDX や data 属性の値 (文字列のことがある) を寸法にする。どちらかが無い・正でなければ null */
export function toDimensions(
  width: number | string | undefined,
  height: number | string | undefined
): ImageDimensions | null {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** 画像の表示幅 (= 元の幅と記事の幅の小さい方) に合わせた sizes */
export function articleImageSizes(width?: number): string {
  const desktop = width ? Math.min(width, ARTICLE_COLUMN_PX) : ARTICLE_COLUMN_PX;
  return `(max-width: ${COLUMN_BREAKPOINT_PX}px) ${ARTICLE_COLUMN_VW}vw, ${desktop}px`;
}

export function nextImageUrl(src: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${OPTIMIZER_QUALITY}`;
}

/**
 * 拡大表示のスライド。寸法が分かる画像は、変換版を srcSet に並べる: 元の幅以下の変換幅と、
 * 元の幅を超える最小の変換幅 (変換は拡大しないので、元の大きさの画像が返る)。
 * 極端に縦長の画像は、変換後の高さが上限に収まる幅まで。寸法が分からない画像は元の URL をそのまま使う
 */
export function toLightboxSlide(image: { src: string; alt: string } & Partial<ImageDimensions>): SlideImage {
  const { src, alt, width, height } = image;
  if (!width || !height) return { src, alt };
  const limit =
    maxOptimizableWidth(width, height) ?? OPTIMIZER_WIDTHS.find((w) => w >= width) ?? OPTIMIZER_WIDTHS.at(-1)!;
  // srcSet の幅は、実際に返る画像の幅 (元の幅を超えない)
  const srcSet = OPTIMIZER_WIDTHS.filter((w) => w <= limit).map((w) => {
    const actual = Math.min(w, width);
    return { src: nextImageUrl(src, w), width: actual, height: Math.round((height / width) * actual) };
  });
  return { src: srcSet.at(-1)!.src, alt, width, height, srcSet };
}
