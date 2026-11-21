import Link from 'next/link';

import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import { diffInDays, todayInJst } from '@/lib/occurrence/status';
import type { OccurrenceReviews } from '@/lib/reviews/queries';

import { OwnReviewStatus } from './OwnReviewStatus';
import { ReviewCard } from './ReviewCard';
import { ReviewStars } from './ReviewStars';

/**
 * 開催のページの口コミの欄 (Figma #3)。評価 (星の平均・件数)・「口コミを書く」・みんなの口コミ (新着順)。
 *
 * 状態ごとの出し分け (仕様 #156):
 * - 開催中・終了: すべて出す。0 件なら最初の口コミを促す
 * - 開催前: 評価の欄は出さず、始まったら書けることだけを出す
 * - 中止・日程未発表: 評価の欄も投稿の入口も出さない
 *
 * 星の分布・行った人のデータ・並び替え・写真・参考になった・通報は後のチケット (#165 ほか)。
 */
export function OccurrenceReviewsSection(props: {
  occurrenceId: number;
  status: OccurrenceStatus;
  endsOn: string | null;
  reviewPath: string;
  reviews: OccurrenceReviews;
}) {
  const { status, reviews } = props;
  if (status === 'cancelled' || status === 'unscheduled') return null;

  if (status === 'scheduled') {
    return (
      <section aria-labelledby="reviews-heading" className="mb-10">
        <h2 id="reviews-heading" className="mb-3 font-display text-xl font-bold text-ink-strong">
          みんなの口コミ
        </h2>
        <p className="rounded-2xl border border-(--line-soft) bg-white p-4 text-sm text-ink-body">
          開催が始まったら、行った人の口コミを書けるようになります。
        </p>
      </section>
    );
  }

  const daysLeft =
    status === 'ongoing' && props.endsOn ? diffInDays(todayInJst(), props.endsOn) : null;

  return (
    <section aria-labelledby="reviews-heading" className="mb-10 flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-(--line-soft) bg-primary-50/40 p-3">
        <div className="w-24 shrink-0 text-center">
          <p
            className="font-display text-3xl font-black leading-none text-ink-strong"
            data-testid="rating-average"
          >
            {reviews.ratingAverage !== null ? reviews.ratingAverage.toFixed(1) : '—'}
          </p>
          <ReviewStars rating={reviews.ratingAverage ?? 0} className="mt-1 block text-[15px]" />
          <p className="mt-1 text-xs text-ink-muted" data-testid="rating-count">
            {reviews.ratingCount}件
          </p>
        </div>
        <p className="text-xs leading-relaxed text-ink-body">
          {reviews.ratingCount > 0
            ? '行った人の満足度の平均です。'
            : 'まだ口コミはありません。行った方は、最初の口コミを書いてみませんか。'}
        </p>
      </div>

      <WriteButton href={props.reviewPath} />
      <OwnReviewStatus occurrenceId={props.occurrenceId} />

      <div className="flex flex-col gap-4 rounded-2xl border border-(--line-soft) bg-white p-4">
        <h2 id="reviews-heading" className="font-display text-base font-bold text-ink-strong">
          みんなの口コミ
        </h2>
        {reviews.latest.length === 0 ? (
          <p className="text-sm text-ink-muted">まだ口コミはありません。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-(--line-soft)">
            {reviews.latest.map(review => (
              <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 画面の下に固定の「口コミを書く」(Figma #3)。本文の中のボタンと同じ先へ行く */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-(--line-soft) bg-white/95 px-4 pt-3 pb-4 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-2">
          {daysLeft !== null && daysLeft >= 0 && (
            <p className="shrink-0 text-xs leading-snug text-ink-muted">
              あと<span className="font-bold text-ink-strong">{daysLeft}日</span>で
              <br />
              終了します
            </p>
          )}
          <WriteButton href={props.reviewPath} compact />
        </div>
      </div>
    </section>
  );
}

function WriteButton({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className={`block flex-1 rounded-2xl bg-primary-strong text-center font-display text-base font-bold text-white shadow-[0_4px_6px_rgb(11_147_213/0.3)] transition-colors hover:bg-primary-strong-hover ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      口コミを書く
    </Link>
  );
}
