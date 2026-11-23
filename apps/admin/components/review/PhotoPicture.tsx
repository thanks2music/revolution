import type { ReviewPhotoView } from '@revolution/reviews/photos/storage';

/**
 * 口コミの写真 1 枚 (AVIF と WebP の段を srcset で出す)。公開サイトの ReviewPhotoPicture と同じ作り
 * (アプリの間では部品を共有しない。2026-11-23 BOSS 確定)
 */
export function PhotoPicture({
  view,
  sizes,
  alt,
  className,
  pictureClassName,
  lazy = false,
}: {
  view: ReviewPhotoView;
  sizes: string;
  alt: string;
  className?: string;
  pictureClassName?: string;
  lazy?: boolean;
}) {
  return (
    <picture className={pictureClassName}>
      <source type="image/avif" srcSet={view.avifSrcSet} sizes={sizes} />
      <img
        src={view.src}
        srcSet={view.webpSrcSet}
        sizes={sizes}
        width={view.width}
        height={view.height}
        alt={alt}
        loading={lazy ? 'lazy' : undefined}
        className={className}
      />
    </picture>
  );
}
