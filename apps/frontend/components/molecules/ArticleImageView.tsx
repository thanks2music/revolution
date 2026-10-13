'use client';

import Image, { type ImageLoaderProps } from 'next/image';
import {
  articleImageSizes,
  maxOptimizableWidth,
  nextImageUrl,
  type ImageDimensions,
} from '@/lib/mdx/article-image';

interface ArticleImageViewProps {
  src: string;
  alt: string;
  /** 寸法が分からない画像は null (記事の幅いっぱいで出す) */
  dimensions: ImageDimensions | null;
  priority: boolean;
}

/**
 * `ArticleImage` (サーバー) が寸法を決めたあとの描画。`loader` は関数なのでサーバーから渡せず、ここで作る。
 * 極端に縦長の画像は、変換後の高さが WebP / AVIF の上限を超えない幅までしか変換版を要求しない
 * (超えると元の 7 MB の JPEG がそのまま返る)
 */
export function ArticleImageView({ src, alt, dimensions, priority }: ArticleImageViewProps) {
  const maxWidth = dimensions && maxOptimizableWidth(dimensions.width, dimensions.height);
  const loader = maxWidth
    ? ({ width: requested }: ImageLoaderProps) => nextImageUrl(src, Math.min(requested, maxWidth))
    : undefined;

  return (
    <Image
      src={src}
      alt={alt}
      width={dimensions?.width ?? 0}
      height={dimensions?.height ?? 0}
      sizes={articleImageSizes(dimensions?.width)}
      // Next.js 16 で priority は非推奨 (preload を使う)。冒頭の画像は LCP になるので eager で読む
      preload={priority}
      loading={priority ? 'eager' : undefined}
      loader={loader}
      className="mx-auto block h-auto w-full cursor-zoom-in"
      style={dimensions ? { maxWidth: `${dimensions.width}px` } : undefined}
      data-lightbox-src={src}
      data-lightbox-width={dimensions?.width}
      data-lightbox-height={dimensions?.height}
      // 押すと拡大表示 (ダイアログ) を開く。名前は alt のまま読み上げる (aria-label で上書きしない)
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
    />
  );
}

export default ArticleImageView;
