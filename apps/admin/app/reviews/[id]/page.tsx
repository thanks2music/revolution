import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getReviewForModeration } from '@revolution/reviews/moderation';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';

import { AdminBar } from '@/components/AdminBar';
import { QueueList } from '@/components/QueueList';
import { QueueTabs } from '@/components/QueueTabs';
import { ReviewDetail } from '@/components/review/ReviewDetail';
import { getAdminSession } from '@/lib/auth/admin';
import { detailKind, queueOrder, queuePosition } from '@/lib/moderation/format';
import { loadQueues } from '@/lib/moderation/queues';

export const dynamic = 'force-dynamic';

/**
 * 口コミの確認 (Figma 14・15、136:355〜136:607、F-6〜F-12)。スマホは 1 画面、PC は左に一覧 (13-PC)。
 * 写真は保管側の短時間だけ有効な URL で出す (非公開の写真も BOSS には見える)
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) notFound();

  const session = await getAdminSession();
  if (!session) redirect('/forbidden');
  const [{ queue, counts }, detail] = await Promise.all([
    loadQueues(session.supabase),
    getReviewForModeration(session.supabase, getReviewPhotoStorage(), reviewId),
  ]);
  if (detail.kind === 'forbidden') redirect('/forbidden');
  if (detail.kind === 'not_found') notFound();

  const { review, stuck, pendingSince, event, occurrence, authorName, photos, history } =
    detail.review;
  const order = queueOrder(queue);

  return (
    <>
      <div className="hidden lg:block">
        <AdminBar email={session.email} />
      </div>
      <header className="flex items-center justify-between bg-bar px-4 py-3.5 lg:hidden">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span aria-hidden className="text-base font-bold">
            ←
          </span>
          <span className="font-display text-[15px] font-bold">口コミの確認</span>
        </Link>
        <span className="text-xs text-bar-muted">{queuePosition(order, reviewId)}</span>
      </header>
      <main className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(320px,420px)_1fr] lg:gap-6 lg:p-6">
        <div className="hidden bg-surface lg:block lg:self-start lg:rounded-2xl lg:border lg:border-line">
          <QueueTabs active="queue" counts={counts} />
          <QueueList items={queue} selectedId={reviewId} />
        </div>
        {/* 読み直した時 (写真が変わった・状態が変わった) に、写真の印と知らせを作り直す */}
        <ReviewDetail
          key={`${review.id}:${review.submitted_at}:${review.status}:${photos.map(photo => photo.id).join(',')}`}
          kind={detailKind(review, stuck)}
          pendingSince={pendingSince}
          review={{
            id: review.id,
            rating: review.rating,
            body: review.body,
            visitedOn: review.visited_on,
            attendance: review.attendance,
            foodCostBand: review.food_cost_band,
            goodsCostBand: review.goods_cost_band,
            hasSpoiler: review.has_spoiler,
            submittedAt: review.submitted_at,
            reasonCode: review.reason_code,
            aiReason: review.ai_reason,
            aiError: review.ai_error,
          }}
          title={[event.name, occurrence.venue_name].filter(Boolean).join(' ')}
          authorName={authorName}
          photos={photos}
          history={history.map(entry => ({
            id: entry.id,
            actor: entry.actor,
            action: entry.action,
            toStatus: entry.to_status,
            reasonCode: entry.reason_code,
            createdAt: entry.created_at,
          }))}
        />
      </main>
    </>
  );
}
