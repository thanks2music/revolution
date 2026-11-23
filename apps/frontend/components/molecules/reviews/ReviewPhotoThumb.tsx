import type { PublicReviewPhoto } from '@/lib/reviews/photos/public';

/**
 * 口コミの写真 1 枚の小さい表示 (Figma #3)。押すと最大の段を新しいタブで開く。
 * 自前で作った段を srcset で出す (Vercel の画像変換を通さない。仕様 #156)
 */
export function ReviewPhotoThumb(props: {
  photo: PublicReviewPhoto;
  /** 表示の一辺 (px) */
  size: number;
  alt: string;
}) {
  const { photo, size, alt } = props;
  const sizes = `${size}px`;
  return (
    <a
      href={photo.src}
      target="_blank"
      rel="noopener"
      className="block shrink-0 overflow-hidden rounded-lg bg-muted"
      style={{ width: size, height: size }}
    >
      <picture>
        <source type="image/avif" srcSet={photo.avifSrcSet} sizes={sizes} />
        <img
          src={photo.src}
          srcSet={photo.webpSrcSet}
          sizes={sizes}
          width={photo.width}
          height={photo.height}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </picture>
    </a>
  );
}
