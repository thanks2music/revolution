import type { ReviewGallery as Gallery } from '@/lib/reviews/queries';

import { ReviewPhotoThumb } from './ReviewPhotoThumb';

/**
 * みんなの口コミの写真のギャラリー (Figma #3 `6:189`)。ネタバレの口コミと非公開の写真は入らない
 * (`getOccurrenceReviews` が除く)。並べきれない時は、最後のマスに残りの枚数を出す。
 * すべての写真を見るページは後のチケット
 */
export function ReviewGallery({ gallery }: { gallery: Gallery }) {
  if (gallery.photos.length === 0) return null;
  const overflow = gallery.total > gallery.photos.length;
  // 残りがある時は最後のマスを枚数に使う
  const shown = overflow ? gallery.photos.slice(0, -1) : gallery.photos;
  const rest = gallery.total - shown.length;

  return (
    <ul className="flex gap-1" aria-label="口コミの写真" data-testid="review-gallery">
      {shown.map((photo, index) => (
        <li key={photo.id}>
          <ReviewPhotoThumb photo={photo} size={72} alt={`口コミの写真 ${index + 1}`} />
        </li>
      ))}
      {overflow && (
        <li
          className="flex size-[72px] items-center justify-center rounded-lg bg-status-scheduled-surface text-[11px] font-bold text-status-scheduled-ink"
          aria-label={`ほか ${rest} 枚`}
        >
          +{rest}
        </li>
      )}
    </ul>
  );
}
