import type { PublicReviewPhoto } from '@/lib/reviews/photos/public';

import { ReviewPhotoPicture } from './ReviewPhotoPicture';

/** 公開の口コミの写真の小さい表示 (Figma #3)。押すと最大の段を新しいタブで開く */
export function ReviewPhotoThumb(props: {
  photo: PublicReviewPhoto;
  /** 表示の一辺 (px) */
  size: number;
  alt: string;
}) {
  const { photo, size, alt } = props;
  return (
    <a
      href={photo.src}
      target="_blank"
      rel="noopener"
      aria-label={`${alt}（大きいサイズを新しいタブで開く）`}
      className="block shrink-0 overflow-hidden rounded-lg bg-muted"
      style={{ width: size, height: size }}
    >
      <ReviewPhotoPicture
        photo={photo}
        size={size}
        alt={alt}
        lazy
        className="size-full object-cover"
      />
    </a>
  );
}
