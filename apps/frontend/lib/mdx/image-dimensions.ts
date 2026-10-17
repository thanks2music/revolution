import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { imageSize } from 'image-size';
import { isOwnImageUrl, type ImageDimensions } from '@/lib/mdx/article-image';

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
 * - キャッシュするのは寸法 (幅と高さ) だけ。画像の取得自体は Next.js の fetch のキャッシュに載せない
 *   (Range の応答は 206 で、fetch のキャッシュは 200 しか保存しない。Range を無視して 200 で全体が返ると、
 *   キャッシュのために本文を丸ごと読んでしまう)。R2 の画像の URL は中身が変わらないので、寸法は期限なしで保存する
 */

const RANGE_BYTES = [64 * 1024, 512 * 1024];
/** 1 回の取得の時間切れ。配信元が遅くても記事の描画を止めない (時間切れは null = 記事の幅いっぱい) */
const FETCH_TIMEOUT_MS = 5000;

/**
 * 先頭の bytes バイトだけを読み、残りは捨てる (配信元が Range を無視して全体を返しても、丸ごとは読まない)。
 * 取得に失敗したら例外を投げる (時間切れ・ネットワーク・2xx 以外。404 もアップロードの前後で一時的にありうる)
 */
async function readHead(src: string, bytes: number): Promise<Uint8Array> {
  const response = await fetch(src, {
    headers: { Range: `bytes=0-${bytes - 1}` },
    cache: 'no-store',
    // 自前の配信元だけを読む (確かめたのは最初の URL なので、リダイレクトには従わない)
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) throw new Error(`image head fetch failed: ${response.status} ${src}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  // 残りは捨てる。cancel の完了は待たない (Next.js の fetch の中では待つと応答が終わらないことがあった)
  void reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, bytes);
}

/**
 * 寸法を読む。取得の失敗は例外のまま上げる (unstable_cache は例外を保存しないので、次の描画で取り直す)。
 * 取得できたのに寸法が読めない画像だけ null を返す (これは何度読んでも同じなので保存してよい)
 */
async function readDimensions(src: string): Promise<ImageDimensions | null> {
  for (const bytes of RANGE_BYTES) {
    const head = await readHead(src, bytes);
    try {
      const { width, height, orientation } = imageSize(head);
      if (!(width > 0 && height > 0)) continue;
      // EXIF の向き 5〜8 は 90 度回転して表示される (ブラウザも変換も回転する) ので、幅と高さを入れ替える
      return orientation && orientation >= 5 ? { width: height, height: width } : { width, height };
    } catch {
      // 先頭だけでは寸法まで届かなかった。次の大きさで取り直す
    }
  }
  return null;
}

const readDimensionsCached = unstable_cache(readDimensions, ['article-image-dimensions'], { revalidate: false });

export const getImageDimensions = cache(async (src: string): Promise<ImageDimensions | null> => {
  if (!isOwnImageUrl(src)) return null;
  try {
    return await readDimensionsCached(src);
  } catch {
    // 取得に失敗した (保存されない)。この描画では記事の幅いっぱいで出す
    return null;
  }
});
