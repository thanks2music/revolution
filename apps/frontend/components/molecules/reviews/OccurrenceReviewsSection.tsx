import Link from 'next/link';

import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import { remainingDays } from '@/lib/occurrence/status';
import { reviewSectionMode, reviewStateKind } from '@revolution/reviews/eligibility';
import type { PublicReview, ReviewGallery as Gallery } from '@/lib/reviews/queries';
import type { ReviewStats } from '@/lib/reviews/stats';

import { HelpfulProvider } from './HelpfulButton';
import { ReviewGallery } from './ReviewGallery';
import { OwnReviewStatus } from './OwnReviewStatus';
import { ReviewStateCard } from './ReviewStateCard';
import { ReviewCard } from './ReviewCard';
import { ReviewSortTabs } from './ReviewSortTabs';
import { RatingDistribution, VisitorData } from './ReviewStatsBars';
import { ReviewStars } from './ReviewStars';

/**
 * 開催のページの口コミの欄 (Figma #3)。評価 (星の平均・件数)・「口コミを書く」・みんなの口コミ (新着順)。
 * 状態ごとの出し方は `reviewSectionMode` (開催前は始まったら書けることだけ、中止・日程未発表は出さない)。
 *
 * 星の分布・行った人のデータ・並び替え (新着順 / 参考になった順)・参考になった は #165。写真とギャラリーは #164。
 * 通報は後のチケット。
 */
export function OccurrenceReviewsSection(props: {
  occurrenceId: number;
  status: OccurrenceStatus;
  /** 開催前の「いつから書けるか」に使う */
  startsOn: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  reviewPath: string;
  /** 新着順 */
  reviews: PublicReview[];
  /** 参考になった順 */
  mostHelpful: PublicReview[];
  stats: ReviewStats;
  gallery: Gallery;
}) {
  const mode = reviewSectionMode(props.status);
  if (mode === 'none') return null;
  // 口コミの状態 (開催前・0 件・終了)。開催中で口コミがある時は、大きな「口コミを書く」だけを出す
  const stateKind = reviewStateKind(props.status, props.ratingCount);

  return (
    <section aria-labelledby="reviews-heading" className="mb-10 flex flex-col gap-4">
      <h2 id="reviews-heading" className="font-display text-xl font-bold text-ink-strong">
        みんなの口コミ
      </h2>

      {mode === 'notYet' ? (
        <ReviewStateCard kind="notYet" startsOn={props.startsOn} reviewPath={props.reviewPath} />
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
            {props.ratingCount > 0 && <RatingDistribution bars={props.stats.rating} />}
          </div>

          {stateKind ? (
            <ReviewStateCard
              kind={stateKind}
              startsOn={props.startsOn}
              reviewPath={props.reviewPath}
            />
          ) : (
            <WriteReviewButton href={props.reviewPath} />
          )}
          <OwnReviewStatus occurrenceId={props.occurrenceId} />

          <VisitorData stats={props.stats} reviewCount={props.ratingCount} />

          <div className="flex flex-col gap-3 rounded-2xl border border-(--line-soft) bg-white p-4">
            {props.reviews.length === 0 ? (
              <p className="text-sm text-ink-muted">まだ口コミはありません。</p>
            ) : (
              <>
                <ReviewGallery gallery={props.gallery} />
                {/* 会員が押したかどうかは、2 つの一覧の口コミをまとめて 1 回で取る */}
                <HelpfulProvider
                  reviewIds={[
                    ...new Set([...props.reviews, ...props.mostHelpful].map(review => review.id)),
                  ]}
                >
                  <ReviewSortTabs
                    latest={<ReviewList reviews={props.reviews} />}
                    helpful={<ReviewList reviews={props.mostHelpful} />}
                  />
                </HelpfulProvider>
              </>
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

function ReviewList({ reviews }: { reviews: PublicReview[] }) {
  return (
    <ul className="flex flex-col divide-y divide-(--line-soft)">
      {reviews.map(review => (
        <li key={review.id} className="py-4 first:pt-0 last:pb-0">
          <ReviewCard review={review} />
        </li>
      ))}
    </ul>
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
