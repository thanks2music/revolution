import { redirect } from 'next/navigation';


import { AdminBar } from '@/components/AdminBar';
import { EmptyQueue } from '@/components/EmptyQueue';
import { Notice } from '@/components/Notice';
import { QueueList } from '@/components/QueueList';
import { QueueTabs } from '@/components/QueueTabs';
import { getAdminSession } from '@/lib/auth/admin';
import { isNoticeKind } from '@/lib/moderation/notice';
import { loadQueues } from '@/lib/moderation/queues';

export const dynamic = 'force-dynamic';

/** 確認待ちの一覧 (Figma 13、F-4・F-9)。PC では右に「口コミを選ぶ」の案内を出す (13-PC) */
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; title?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect('/forbidden');
  const { queue, counts } = await loadQueues(session.supabase);
  const { notice, title } = await searchParams;

  return (
    <>
      <AdminBar email={session.email} />
      <main className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(320px,420px)_1fr] lg:gap-6 lg:p-6">
        <div className="bg-surface lg:self-start lg:rounded-2xl lg:border lg:border-line">
          <QueueTabs active="queue" counts={counts} />
          {queue.length === 0 ? (
            <EmptyQueue checkedAt={new Date().toISOString()} />
          ) : (
            <QueueList items={queue} />
          )}
        </div>
        <div className="hidden items-center justify-center rounded-2xl border border-dashed border-line text-sm text-ink-muted lg:flex">
          左の一覧から口コミを選んでください
        </div>
      </main>
      {/* 知らせは URL から読むので、種類は決まった物だけ、名前は長さを切って出す (React が文字として出す) */}
      {isNoticeKind(notice) && <Notice kind={notice} title={(title ?? '口コミ').slice(0, 200)} />}
    </>
  );
}
