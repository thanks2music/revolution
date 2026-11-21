/**
 * #12 マイページの「自分の口コミ」(Figma `83:191`、one-more-time #162)。
 *
 * 状態のバッジ・開催・星と訪問日・差し戻しと非公開の理由・編集と削除の入口を並べる。
 * 編集はどの状態でも #7 の投稿のページ (その口コミの編集になる) を開く。
 */

import Link from 'next/link';

import type { OwnReviewListItem } from '@/lib/reviews/own-reviews';
import { ownReviewMeta, ownReviewView, type OwnReviewTone } from '@/lib/reviews/own-review-view';

import { DeleteOwnReviewButton } from './DeleteOwnReviewButton';
import { ReviewStars } from './ReviewStars';

const BADGE_TONES: Record<OwnReviewTone, string> = {
  draft: 'bg-status-scheduled-surface text-status-scheduled-ink',
  screening: 'bg-primary-50 text-primary-700',
  published: 'bg-success-surface text-success-ink',
  problem: 'bg-status-cancelled-surface text-status-cancelled',
};

export function OwnReviewList(props: { reviews: OwnReviewListItem[] }) {
  if (props.reviews.length === 0) {
    return (
      <p className="mt-6 max-w-prose border-l-[3px] border-(--line-soft) bg-bg-tinted px-5 py-4 text-sm leading-relaxed text-ink-body">
        まだ口コミはありません。行った開催のページの「口コミを書く」から書けます。
      </p>
    );
  }
  return (
    <ul className="mt-6 flex flex-col gap-3">
      {props.reviews.map(review => (
        <li key={review.id}>
          <OwnReviewItem review={review} />
        </li>
      ))}
    </ul>
  );
}

function OwnReviewItem({ review }: { review: OwnReviewListItem }) {
  const view = ownReviewView(review);
  const meta = ownReviewMeta(review);
  const title = review.venueName ? `${review.eventName} ${review.venueName}` : review.eventName;

  return (
    <article
      data-testid="own-review-item"
      className="flex flex-col gap-2 rounded-2xl border border-(--line-soft) bg-white px-4 py-4"
    >
      <p>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE_TONES[view.tone]}`}
        >
          {view.badge}
        </span>
      </p>
      <h3 className="text-sm font-bold text-ink-strong">
        <Link href={review.occurrencePath} className="text-ink-strong hover:underline">
          {title}
        </Link>
      </h3>
      {(review.rating !== null || meta) && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-muted">
          {review.rating !== null && <ReviewStars rating={review.rating} className="text-xs" />}
          {review.rating !== null && meta && <span aria-hidden="true">・</span>}
          {meta && <span>{meta}</span>}
        </p>
      )}
      {view.reason && (
        <p className="rounded-[10px] bg-status-cancelled-surface px-3 py-2.5 text-[11px] text-status-cancelled">
          {view.reason}
        </p>
      )}
      <div className="flex items-center gap-4 text-xs font-bold">
        {/* 中止になった開催の下書きなど、もう続きを書けない口コミは削除だけにする */}
        {review.canEdit && (
          <Link
            href={`${review.occurrencePath}/review`}
            className="text-primary-700 hover:underline"
          >
            {view.editLabel}
          </Link>
        )}
        <DeleteOwnReviewButton route={review.route} reviewId={review.id} />
      </div>
    </article>
  );
}
