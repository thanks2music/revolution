/**
 * 画像の配信と変換の設定。next.config.mjs の images と、記事の画像処理 (lib/mdx/article-image.ts) が共有する。
 * 記事の拡大表示と縦長の画像は /_next/image の URL を自前で組み立てるため、ここに無い幅・品質を要求すると 400 になる
 */

/** next/image の deviceSizes */
export const IMAGE_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];

/** next/image の imageSizes */
export const IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];

/** next/image の qualities (Next.js 16 の既定値) */
export const IMAGE_QUALITIES = [75];

/** 記事の画像の配信元 (Cloudflare R2)。remotePatterns に入れ、記事の画像の寸法の取得もここだけに限る */
export const R2_IMAGE_HOST = 'images.anime-events.com';
