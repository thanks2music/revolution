import type { PublicReview } from '@/lib/reviews/queries';
import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  formatVisitedMonth,
} from '@/lib/reviews/labels';

import { ReviewStars } from './ReviewStars';
import { SpoilerBody } from './SpoilerBody';

const EDITED_AT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 口コミ 1 件 (Figma #3)。写真・参考になった・通報の「…」・プロフィール画像は後のチケット
 * (#163/#164・#165・#168・#171)
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

      {body && (review.hasSpoiler ? <SpoilerBody>{body}</SpoilerBody> : body)}

      {review.editedAt && (
        <p className="text-xs text-ink-muted">
          最終編集 {EDITED_AT.format(new Date(review.editedAt)).replaceAll('/', '.')}
        </p>
      )}
    </article>
  );
}
