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

/** 自前の画像の配信元 (next.config の images.remotePatterns にある R2 の配信元) */
const OWN_IMAGE_HOSTS = new Set(['images.anime-events.com']);

export function isOwnImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && OWN_IMAGE_HOSTS.has(url.hostname);
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

/** 公開日・更新日を日本時間の日付で (サーバーは UTC で描くため、タイムゾーンを明示する) */
export function formatJstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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
 * 拡大表示のスライド。寸法が分かる画像は、変換版を srcSet に並べる。
 * 元の幅以下の変換幅に加えて、元の幅を超える最小の変換幅も入れる (変換は拡大しないので、元の大きさの画像が返る)。
 * 極端に縦長の画像は、変換後の高さが上限に収まる幅まで。寸法が分からない画像は元の URL をそのまま使う
 */
export function toLightboxSlide(image: LightboxImage): LightboxSlide {
  const { src, alt, width, height } = image;
  if (!width || !height) return { src, alt };
  const capped = maxOptimizableWidth(width, height);
  const widths = capped
    ? OPTIMIZER_WIDTHS.filter((w) => w <= capped)
    : [
        ...OPTIMIZER_WIDTHS.filter((w) => w < width),
        OPTIMIZER_WIDTHS.find((w) => w >= width) ?? OPTIMIZER_WIDTHS[OPTIMIZER_WIDTHS.length - 1],
      ];
  // srcSet の幅は、実際に返る画像の幅 (元の幅を超えない)
  const entries = widths.map((w) => {
    const actual = Math.min(w, width);
    return { src: nextImageUrl(src, w), width: actual, height: Math.round((height / width) * actual) };
  });
  return { src: entries[entries.length - 1].src, alt, width, height, srcSet: entries };
}
