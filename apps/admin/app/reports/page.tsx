import { redirect } from 'next/navigation';

import { listReviewQueue } from '@revolution/reviews/moderation';
import { listReportQueue } from '@revolution/reviews/reports';

import { AdminBar } from '@/components/AdminBar';
import { Notice } from '@/components/Notice';
import { QueueTabs } from '@/components/QueueTabs';
import { ReportList } from '@/components/ReportList';
import { getAdminSession } from '@/lib/auth/admin';
import { isNoticeKind } from '@/lib/moderation/notice';

export const dynamic = 'force-dynamic';

/** 通報の一覧 (Figma 16 / 16-PC、one-more-time #168)。PC では右に「通報を選ぶ」の案内を出す */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; title?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect('/forbidden');
  const [queue, reports] = await Promise.all([
    listReviewQueue(session.supabase),
    listReportQueue(session.supabase),
  ]);
  if (queue.kind === 'forbidden' || reports.kind === 'forbidden') redirect('/forbidden');
  const { notice, title } = await searchParams;

  return (
    <>
      <AdminBar email={session.email} />
      <main className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(320px,420px)_1fr] lg:gap-6 lg:p-6">
        <div className="bg-surface lg:self-start lg:rounded-2xl lg:border lg:border-line">
          <QueueTabs
            active="reports"
            counts={{ queue: queue.items.length, reports: reports.items.length }}
          />
          <ReportList items={reports.items} />
        </div>
        <div className="hidden items-center justify-center rounded-2xl border border-dashed border-line text-sm text-ink-muted lg:flex">
          左の一覧から通報を選んでください
        </div>
      </main>
      {isNoticeKind(notice) && (
        <Notice kind={notice} title={(title ?? '口コミ').slice(0, 200)} path="/reports" />
      )}
    </>
  );
}
