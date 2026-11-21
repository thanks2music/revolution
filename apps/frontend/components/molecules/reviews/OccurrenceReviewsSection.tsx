import Link from 'next/link';

import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import { remainingDays } from '@/lib/occurrence/status';
import { reviewSectionMode } from '@/lib/reviews/eligibility';
import type { PublicReview } from '@/lib/reviews/queries';

import { OwnReviewStatus } from './OwnReviewStatus';
import { ReviewCard } from './ReviewCard';
import { ReviewStars } from './ReviewStars';

/**
 * 開催のページの口コミの欄 (Figma #3)。評価 (星の平均・件数)・「口コミを書く」・みんなの口コミ (新着順)。
 * 状態ごとの出し方は `reviewSectionMode` (開催前は始まったら書けることだけ、中止・日程未発表は出さない)。
 *
 * 星の分布・行った人のデータ・並び替え・写真・参考になった・通報は後のチケット (#165 ほか)。
 */
export function OccurrenceReviewsSection(props: {
  occurrenceId: number;
  status: OccurrenceStatus;
  ratingAverage: number | null;
  ratingCount: number;
  reviewPath: string;
  reviews: PublicReview[];
}) {
  const mode = reviewSectionMode(props.status);
  if (mode === 'none') return null;

  return (
    <section aria-labelledby="reviews-heading" className="mb-10 flex flex-col gap-4">
      <h2 id="reviews-heading" className="font-display text-xl font-bold text-ink-strong">
        みんなの口コミ
      </h2>

      {mode === 'notYet' ? (
        <p className="rounded-2xl border border-(--line-soft) bg-white p-4 text-sm text-ink-body">
          開催が始まったら、行った人の口コミを書けるようになります。
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-(--line-soft) bg-primary-50/40 p-3">
            <div className="w-24 shrink-0 text-center">
              <p
                className="font-display text-3xl font-black leading-none text-ink-strong"
                data-testid="rating-average"
              >
                {props.ratingAverage !== null ? props.ratingAverage.toFixed(1) : '—'}
              </p>
              {props.ratingAverage !== null && (
                <ReviewStars rating={props.ratingAverage} className="mt-1 block text-[15px]" />
              )}
              <p className="mt-1 text-xs text-ink-muted" data-testid="rating-count">
                {props.ratingCount}件
              </p>
            </div>
            <p className="text-xs leading-relaxed text-ink-body">
              {props.ratingCount > 0
                ? '行った人の満足度の平均です。'
                : 'まだ口コミはありません。行った方は、最初の口コミを書いてみませんか。'}
            </p>
          </div>

          <WriteReviewButton href={props.reviewPath} />
          <OwnReviewStatus occurrenceId={props.occurrenceId} />

          <div className="rounded-2xl border border-(--line-soft) bg-white p-4">
            {props.reviews.length === 0 ? (
              <p className="text-sm text-ink-muted">まだ口コミはありません。</p>
            ) : (
              <ul className="flex flex-col divide-y divide-(--line-soft)">
                {props.reviews.map(review => (
                  <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                    <ReviewCard review={review} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 画面の下に固定する「口コミを書く」(Figma #3、スマホだけ)。`Layout` の `bottomBar` に渡す
 * (下のタブのバーの上に置き、ページの末尾の余白も Layout が持つ)。渡すのは開催中・終了の開催だけ
 * (`reviewSectionMode` が full の時)。渡さなければ Layout は枠も余白も足さない
 */
export function ReviewWriteBar(props: {
  status: OccurrenceStatus;
  endsOn: string | null;
  reviewPath: string;
}) {
  const daysLeft = props.status === 'ongoing' ? remainingDays(props.endsOn) : null;

  return (
    <div className="mx-auto flex max-w-md items-center gap-2">
      {daysLeft !== null && (
        // 日付をまたぐだけで変わる表示 (見た目の回帰テストで隠す。e2e/layout.spec.ts の VOLATILE_MASK)
        <p data-volatile="remaining-days" className="shrink-0 text-xs leading-snug text-ink-muted">
          あと<span className="font-bold text-ink-strong">{daysLeft}日</span>で
          <br />
          終了します
        </p>
      )}
      <WriteReviewButton href={props.reviewPath} compact />
    </div>
  );
}

function WriteReviewButton({ href, compact = false }: { href: string; compact?: boolean }) {
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
