/**
 * 記事の画像の表示と拡大表示のための純粋関数 (Layer 1)。
 *
 * - 本文の画像は「元の幅」と「記事の幅」の小さい方で、縦横比のまま出す (2026-10-13 BOSS 決定)
 * - 拡大表示 (yet-another-react-lightbox) のスライドは、`next/image` の変換版 (`/_next/image`) を使う。
 *   変換できる幅は next.config の deviceSizes / imageSizes と同じ値に限られる (それ以外の w は 400)
 */

/** 記事の列の幅 (`--container-main: clamp(0px, 1050px, 90vw)` と同じ) */
export const ARTICLE_COLUMN_PX = 1050;
const ARTICLE_COLUMN_VW = 90;
const COLUMN_BREAKPOINT_PX = Math.ceil(ARTICLE_COLUMN_PX / (ARTICLE_COLUMN_VW / 100));

/** next.config の images.deviceSizes / imageSizes / qualities と同じ値 */
const DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];
const OPTIMIZER_WIDTHS = [...IMAGE_SIZES, ...DEVICE_SIZES].sort((a, b) => a - b);
const OPTIMIZER_QUALITY = 75;

/**
 * 変換後の画像の 1 辺の上限。WebP は 16,383px (AVIF も同程度) で、超える変換版は作れず、
 * Next.js は元の画像をそのまま返す (2026-10-13 実測: 1920×28300 の JPEG で w=1200 以上が 7.3 MB の元画像になった)
 */
const MAX_ENCODED_DIMENSION = 16383;

/**
 * 縦横比を保って変換したときに、高さが上限に収まる最大の変換幅 (元の幅を超えない)。
 * 元の高さが上限以下なら、どの幅でも変換できるので null
 */
export function maxOptimizableWidth(width: number, height: number): number | null {
  if (height <= MAX_ENCODED_DIMENSION) return null;
  const fits = (w: number) => w <= width && Math.round((height / width) * w) <= MAX_ENCODED_DIMENSION;
  return OPTIMIZER_WIDTHS.filter(fits).at(-1) ?? OPTIMIZER_WIDTHS[0];
}

/** サイト共通の OG 画像 (AI Writer がアイキャッチを取れなかったときの値)。冒頭には出さない */
export function isArticleEyecatch(ogImage: string | null | undefined): ogImage is string {
  return typeof ogImage === 'string' && ogImage.startsWith('https://');
}

/** MDX の属性 (文字列のことがある) を寸法にする。どちらかが無い・正でなければ null */
export function toDimensions(
  width: number | string | undefined,
  height: number | string | undefined
): { width: number; height: number } | null {
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

export interface LightboxImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface LightboxSlide {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  srcSet?: { src: string; width: number; height: number }[];
}

/**
 * 拡大表示のスライド。寸法が分かる画像は、元の幅以下 (かつ変換後の高さが上限以下) の変換版を srcSet に並べる
 * (元の幅より大きい変換版は作らない)。寸法が分からない画像は元の URL をそのまま使う
 */
export function toLightboxSlide(image: LightboxImage): LightboxSlide {
  const { src, alt, width, height } = image;
  if (!width || !height) return { src, alt };
  const limit = maxOptimizableWidth(width, height) ?? width;
  const widths = OPTIMIZER_WIDTHS.filter((w) => w <= limit);
  const largest = widths.at(-1) ?? OPTIMIZER_WIDTHS[0];
  return {
    src: nextImageUrl(src, largest),
    alt,
    width,
    height,
    srcSet: (widths.length > 0 ? widths : [largest]).map((w) => ({
      src: nextImageUrl(src, w),
      width: w,
      height: Math.round((height / width) * w),
    })),
  };
}
