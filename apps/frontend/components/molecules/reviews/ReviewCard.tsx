import { formatJstDotDate } from '@/lib/date';
import type { PublicReview } from '@/lib/reviews/queries';
import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  formatVisitedMonth,
} from '@/lib/reviews/labels';

import { HelpfulButton } from './HelpfulButton';
import { ReviewPhotoThumb } from './ReviewPhotoThumb';
import { ReviewStars } from './ReviewStars';
import { SpoilerBody } from './SpoilerBody';

/**
 * 口コミ 1 件 (Figma #3)。ネタバレの口コミは本文と写真をたたむ。通報の「…」・プロフィール画像は
 * 後のチケット (#168・#171)
 */
export function ReviewCard({ review }: { review: PublicReview }) {
  const facts = [
    review.attendance && ATTENDANCE_LABELS[review.attendance],
    review.foodCostBand && `飲食 ${FOOD_COST_BAND_LABELS[review.foodCostBand]}`,
    review.goodsCostBand && `グッズ ${GOODS_COST_BAND_LABELS[review.goodsCostBand]}`,
  ].filter(Boolean);
  const body = review.body && (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-body">{review.body}</p>
  );
  const photos = review.photos.length > 0 && (
    <ul
      className="flex flex-wrap gap-1"
      aria-label={`${review.authorName ?? '退会済みユーザー'}さんの口コミの写真`}
    >
      {review.photos.map((photo, index) => (
        <li key={photo.id}>
          <ReviewPhotoThumb photo={photo} size={64} alt={`写真 ${index + 1}`} />
        </li>
      ))}
    </ul>
  );

  const content = (body || photos) && (
    <>
      {body}
      {photos}
    </>
  );

  return (
    <article className="flex flex-col gap-2" data-testid="review-card">
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`size-8 shrink-0 rounded-full ${
            review.authorName
              ? 'bg-primary-50'
              : 'border border-dashed border-(--line-strong) bg-status-scheduled-surface'
          }`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[13px] font-bold ${review.authorName ? 'text-ink-strong' : 'text-ink-muted'}`}
          >
            {review.authorName ?? '退会済みユーザー'}
          </p>
          {review.visitedMonth && (
            <p className="text-xs text-ink-muted">{formatVisitedMonth(review.visitedMonth)} 訪問</p>
          )}
        </div>
        <ReviewStars rating={review.rating} className="text-[15px]" />
      </header>

      {facts.length > 0 && <p className="text-xs text-ink-body">{facts.join(' ・ ')}</p>}

      {content &&
        (review.hasSpoiler ? (
          <SpoilerBody folded={body && photos ? '本文と写真' : body ? '本文' : '写真'}>
            {content}
          </SpoilerBody>
        ) : (
          content
        ))}

      {/* 足元: 参考になった ・ 最終編集 (Figma #3 `6:219`) */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <HelpfulButton reviewId={review.id} count={review.helpfulCount} />
        {review.editedAt && <span>最終編集 {formatJstDotDate(review.editedAt)}</span>}
      </p>
    </article>
  );
}
