import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getReviewForModeration, listReviewQueue } from '@revolution/reviews/moderation';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { listReportQueue, sortReasonCounts } from '@revolution/reviews/reports';
import type { ReviewReportReason } from '@revolution/schemas/review-constants';

import { AdminBar } from '@/components/AdminBar';
import { QueueTabs } from '@/components/QueueTabs';
import { ReportList } from '@/components/ReportList';
import { ReportDetail } from '@/components/report/ReportDetail';
import { getAdminSession } from '@/lib/auth/admin';
import { agoLabel } from '@/lib/moderation/format';

export const dynamic = 'force-dynamic';

/**
 * 通報された口コミの処理 (Figma 16 / 16-PC `88:438`)。スマホは 1 画面、PC は左に通報の一覧。
 * 写真は保管側の短時間だけ有効な URL で出す (非公開の写真も BOSS には見える)
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) notFound();

  const session = await getAdminSession();
  if (!session) redirect('/forbidden');
  const [queue, reports, detail] = await Promise.all([
    listReviewQueue(session.supabase),
    listReportQueue(session.supabase),
    getReviewForModeration(session.supabase, getReviewPhotoStorage(), reviewId),
  ]);
  if (queue.kind === 'forbidden' || reports.kind === 'forbidden' || detail.kind === 'forbidden') {
    redirect('/forbidden');
  }
  if (detail.kind === 'not_found') notFound();

  const { review, event, occurrence, authorName, photos, openReports } = detail.review;
  const counts: Partial<Record<ReviewReportReason, number>> = {};
  for (const report of openReports)
    counts[report.reasonCode] = (counts[report.reasonCode] ?? 0) + 1;

  return (
    <>
      <div className="hidden lg:block">
        <AdminBar email={session.email} />
      </div>
      <header className="flex items-center bg-bar px-4 py-3.5 lg:hidden">
        <Link href="/reports" className="flex items-center gap-2 text-white">
          <span aria-hidden className="text-base font-bold">
            ←
          </span>
          <span className="font-display text-[15px] font-bold">通報の確認</span>
        </Link>
      </header>
      <main className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(320px,420px)_1fr] lg:gap-6 lg:p-6">
        <div className="hidden bg-surface lg:block lg:self-start lg:rounded-2xl lg:border lg:border-line">
          <QueueTabs
            active="reports"
            counts={{ queue: queue.items.length, reports: reports.items.length }}
          />
          <ReportList items={reports.items} selectedId={reviewId} />
        </div>
        {openReports.length === 0 ? (
          <div className="bg-surface px-4 py-6 text-sm text-ink-body lg:self-start lg:rounded-2xl lg:border lg:border-line lg:px-6">
            この口コミに未処理の通報はありません。
            <Link href="/reports" className="mt-3 block font-bold text-primary">
              ‹ 通報の一覧に戻る
            </Link>
          </div>
        ) : (
          // 読み直した時 (写真・状態・通報が変わった) に、印と知らせを作り直す
          <ReportDetail
            key={`${review.id}:${review.submitted_at}:${review.status}:${photos.map(photo => photo.id).join(',')}:${openReports.map(report => report.id).join(',')}`}
            review={{
              id: review.id,
              status: review.status,
              rating: review.rating,
              body: review.body,
              visitedOn: review.visited_on,
              attendance: review.attendance,
              foodCostBand: review.food_cost_band,
              goodsCostBand: review.goods_cost_band,
              hasSpoiler: review.has_spoiler,
              submittedAt: review.submitted_at,
            }}
            title={[event.name, occurrence.venue_name].filter(Boolean).join(' ')}
            authorName={authorName}
            photos={photos}
            reportIds={openReports.map(report => report.id)}
            reasons={sortReasonCounts(counts)}
            firstReportedLabel={openReports[0] ? agoLabel(openReports[0].createdAt) : null}
          />
        )}
      </main>
    </>
  );
}
