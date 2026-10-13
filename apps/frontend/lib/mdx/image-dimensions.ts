import { cache } from 'react';
import { imageSize } from 'image-size';

/**
 * 記事の画像の元の幅と高さを、画像の先頭だけを取得して読む。
 *
 * 記事の画像は「元の幅」と「記事の幅」の小さい方で出す (小さい画像を引き伸ばさない)。
 * srcset の w 記述子を使うと、ブラウザは画像の本当の幅を知らずに sizes の幅を元の幅とみなすため、
 * 元の幅はサーバーで知る必要がある。AI Writer が寸法を書いた記事 (`<ArticleImage width height>`) では
 * これを使わない。寸法の無い既存の記事のためのもの。
 *
 * - 取得するのは自前の画像の配信元だけ (MDX の中身は自前だが、任意の URL を取りに行かない)
 * - JPEG の寸法は EXIF の後ろにあることがあるので、64 KB で読めなければ 512 KB で取り直す
 * - 読めなければ null (呼び出し側は記事の幅いっぱいで出す)
 */

const IMAGE_HOSTS = new Set(['images.anime-events.com']);
const RANGE_BYTES = [64 * 1024, 512 * 1024];

export interface ImageDimensions {
  width: number;
  height: number;
}

export function isOwnImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function readHead(src: string, bytes: number): Promise<Uint8Array | null> {
  const response = await fetch(src, {
    headers: { Range: `bytes=0-${bytes - 1}` },
    // R2 の画像は中身のハッシュか UUID の名前で、同じ URL の中身は変わらない
    cache: 'force-cache',
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export const getImageDimensions = cache(async (src: string): Promise<ImageDimensions | null> => {
  if (!isOwnImageUrl(src)) return null;
  for (const bytes of RANGE_BYTES) {
    try {
      const head = await readHead(src, bytes);
      if (!head) return null;
      const { width, height } = imageSize(head);
      if (width > 0 && height > 0) return { width, height };
    } catch {
      // 先頭だけでは寸法まで届かなかった。次の大きさで取り直す
    }
  }
  return null;
});
