import Link from 'next/link';

import type { ReportQueueItem } from '@revolution/reviews/reports';

import { agoLabel, reportReasonsLabel, reviewStateLabel } from '@/lib/moderation/format';

/**
 * 通報の一覧 (Figma 16 `86:245`・16-PC `88:437`)。最初の通報が古い順。PC では口コミの確認の左に出し、
 * 開いている口コミを強調する
 */
export function ReportList({
  items,
  selectedId,
  now = new Date(),
}: {
  items: ReportQueueItem[];
  selectedId?: number;
  now?: Date;
}) {
  return (
    <div>
      {items.length === 0 ? (
        <p className="px-4 pt-6 pb-2 text-[13px] text-ink-body">未処理の通報はありません。</p>
      ) : (
        <ul>
          {items.map(item => {
            const title = [item.eventName, item.venueName].filter(Boolean).join(' ');
            return (
              <li key={item.reviewId}>
                <Link
                  href={`/reports/${item.reviewId}`}
                  aria-current={item.reviewId === selectedId ? 'page' : undefined}
                  className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 hover:bg-surface-subtle aria-[current=page]:bg-info-surface"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded bg-danger-surface px-1.5 py-0.5 text-[11px] font-bold text-danger">
                        通報 {item.reportCount} 件
                      </span>
                      <span className="truncate text-[11px] text-ink-body">
                        {reportReasonsLabel(item.reasons)}
                      </span>
                    </span>
                    <span className="truncate text-[13px] font-bold text-ink-strong">{title}</span>
                    <span className="text-[11px] text-ink-muted">
                      {reviewStateLabel(item.status)} ・ 最初の通報{' '}
                      {agoLabel(item.firstReportedAt, now)}
                    </span>
                  </span>
                  <span aria-hidden className="text-lg text-ink-muted">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-4 pt-5 pb-7 text-[11px] text-ink-muted">
        非公開にした口コミは、投稿者のマイページに理由つきで出ます。
      </p>
    </div>
  );
}
