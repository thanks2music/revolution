import { cache } from 'react';
import { imageSize } from 'image-size';
import { isOwnImageUrl } from '@/lib/mdx/article-image';

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

const RANGE_BYTES = [64 * 1024, 512 * 1024];

export interface ImageDimensions {
  width: number;
  height: number;
}

/** 先頭の bytes バイトだけを読む。配信元が Range を無視して全体を返しても、bytes で読むのをやめる */
async function readHead(src: string, bytes: number): Promise<Uint8Array | null> {
  const response = await fetch(src, {
    headers: { Range: `bytes=0-${bytes - 1}` },
    // R2 の画像は中身のハッシュか UUID の名前で、同じ URL の中身は変わらない
    cache: 'force-cache',
  });
  if (!response.ok) return null;
  if (response.status === 206 || !response.body) return new Uint8Array(await response.arrayBuffer());

  // 200 (Range を無視して全体が返った): 先頭だけ読んで残りは捨てる (7 MB の画像を丸ごと読まない)
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel();
  const head = new Uint8Array(Math.min(received, bytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, head.length - offset);
    head.set(part, offset);
    offset += part.length;
    if (offset >= head.length) break;
  }
  return head;
}

export const getImageDimensions = cache(async (src: string): Promise<ImageDimensions | null> => {
  if (!isOwnImageUrl(src)) return null;
  for (const bytes of RANGE_BYTES) {
    try {
      const head = await readHead(src, bytes);
      if (!head) return null;
      const { width, height, orientation } = imageSize(head);
      if (!(width > 0 && height > 0)) continue;
      // EXIF の向き 5〜8 は 90 度回転して表示される (ブラウザも変換も回転する) ので、幅と高さを入れ替える
      return orientation && orientation >= 5 ? { width: height, height: width } : { width, height };
    } catch {
      // 先頭だけでは寸法まで届かなかった。次の大きさで取り直す
    }
  }
  return null;
});
