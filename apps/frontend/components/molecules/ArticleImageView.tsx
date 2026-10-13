'use client';

import Image, { type ImageLoaderProps } from 'next/image';
import { nextImageUrl } from '@/lib/mdx/article-image';

interface ArticleImageViewProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority: boolean;
  /** 変換を要求する幅の上限 (極端に縦長の画像のみ。`maxOptimizableWidth`) */
  maxOptimizedWidth: number | null;
  /** 寸法が分からない画像 (記事の幅いっぱいで出す) */
  unknownSize: boolean;
}

/**
 * `ArticleImage` (サーバー) が寸法を決めたあとの描画。`loader` は関数なのでサーバーから渡せず、ここで作る。
 * 極端に縦長の画像は、変換後の高さが WebP / AVIF の上限を超えない幅までしか変換版を要求しない
 * (超えると元の 7 MB の JPEG がそのまま返る)
 */
export function ArticleImageView({
  src,
  alt,
  width,
  height,
  sizes,
  priority,
  maxOptimizedWidth,
  unknownSize,
}: ArticleImageViewProps) {
  const loader = maxOptimizedWidth
    ? ({ width: requested }: ImageLoaderProps) => nextImageUrl(src, Math.min(requested, maxOptimizedWidth))
    : undefined;

  return (
    <Image
      src={src}
      alt={alt}
      width={unknownSize ? 0 : width}
      height={unknownSize ? 0 : height}
      sizes={sizes}
      // Next.js 16 で priority は非推奨 (preload を使う)。冒頭の画像は LCP になるので eager で読む
      preload={priority}
      loading={priority ? 'eager' : undefined}
      loader={loader}
      className="mx-auto block h-auto w-full cursor-zoom-in"
      style={unknownSize ? undefined : { maxWidth: `${width}px` }}
      data-lightbox-src={src}
      data-lightbox-width={unknownSize ? undefined : width}
      data-lightbox-height={unknownSize ? undefined : height}
      tabIndex={0}
      role="button"
      aria-label={alt ? `${alt} を拡大表示` : '画像を拡大表示'}
    />
  );
}

export default ArticleImageView;
