import type { ReviewPhotoView } from '@revolution/reviews/photos/storage';

/**
 * 口コミの写真 1 枚 (AVIF と WebP の段を srcset で出す)。本人の写真 (投稿画面) と公開の写真 (#3) で共有する。
 * 自前で作った段を出す (Vercel の画像変換を通さない。仕様 #156)
 */
export function ReviewPhotoPicture(props: {
  photo: ReviewPhotoView;
  /** 表示の一辺 (px) */
  size: number;
  alt: string;
  className?: string;
  lazy?: boolean;
}) {
  const { photo, size, alt, className, lazy = false } = props;
  const sizes = `${size}px`;
  return (
    <picture>
      <source type="image/avif" srcSet={photo.avifSrcSet} sizes={sizes} />
      <img
        src={photo.src}
        srcSet={photo.webpSrcSet}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={alt}
        loading={lazy ? 'lazy' : undefined}
        decoding={lazy ? 'async' : undefined}
        className={className}
      />
    </picture>
  );
}
