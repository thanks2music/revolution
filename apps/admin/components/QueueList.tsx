import Link from 'next/link';

import type { ReviewQueueItem } from '@revolution/reviews/moderation';

import {
  agoLabel,
  aiFailureSummary,
  elapsedLabel,
  headlineOf,
  queueSections,
  starsLabel,
} from '@/lib/moderation/format';

const BAR: Record<ReviewQueueItem['kind'], string> = {
  stuck: 'bg-stuck',
  ai_failure: 'bg-danger-ink',
  unsure: 'bg-warning',
};

/** 行の 1 段目 (色つきの見出しと、補足) */
function lead(item: ReviewQueueItem, now: Date) {
  const photos = item.photoCount > 0 ? `写真 ${item.photoCount} 枚` : '本文';
  if (item.kind === 'stuck') {
    return { text: `審査中 ${elapsedLabel(item.pendingSince, now)}`, sub: photos, className: 'text-ink-tertiary' };
  }
  if (item.kind === 'ai_failure') {
    return { text: 'AI の審査に失敗', sub: aiFailureSummary(item.aiError).label, className: 'text-danger-ink' };
  }
  return { text: headlineOf(item.aiReason), sub: photos, className: 'text-warning-ink' };
}

/**
 * 確認待ちの一覧 (Figma 13 `135:418`)。節は止まっている → 失敗 → 迷った、節の中は古い順。
 * PC では口コミの確認の左に出し、開いている口コミを強調する (13-PC)
 */
export function QueueList({
  items,
  selectedId,
  now = new Date(),
}: {
  items: ReviewQueueItem[];
  selectedId?: number;
  now?: Date;
}) {
  return (
    <div>
      <p className="px-4 pt-3 pb-1 text-xs text-ink-body">
        BOSS の確認が要る口コミです。節の中は古い順。止まっている口コミと失敗した口コミは、まず「もう一度 AI
        にかける」を試してください。
      </p>
      {queueSections(items).map(section => (
        <section key={section.kind} aria-label={section.title}>
          <div className="bg-surface-subtle px-4 pt-3.5 pb-2">
            <h2 className="text-[13px] font-bold text-ink-body">
              {section.title}
              <span className="ml-2">{section.items.length}</span>
            </h2>
            <p className="text-[11px] text-ink-tertiary">{section.note}</p>
          </div>
          <ul>
            {section.items.map(item => {
              const { text, sub, className } = lead(item, now);
              const title = [item.eventName, item.venueName].filter(Boolean).join(' ');
              return (
                <li key={item.reviewId}>
                  <Link
                    href={`/reviews/${item.reviewId}`}
                    aria-current={item.reviewId === selectedId ? 'page' : undefined}
                    className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 hover:bg-surface-subtle aria-[current=page]:bg-info-surface"
                  >
                    <span aria-hidden className={`h-16 w-1 shrink-0 rounded-sm ${BAR[item.kind]}`} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate text-[13px] font-bold ${className}`}>{text}</span>
                        <span className="shrink-0 text-[11px] text-ink-muted">{sub}</span>
                      </span>
                      <span className="truncate text-[13px] font-bold text-ink-strong">{title}</span>
                      <span className="text-[11px] text-ink-muted">
                        {item.authorName ?? '退会済みユーザー'} ・ {starsLabel(item.rating)} ・{' '}
                        {agoLabel(item.submittedAt, now)}
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
        </section>
      ))}
      <p className="px-4 pt-5 pb-7 text-[11px] text-ink-muted">
        ここに無い口コミは、AI が公開か差し戻しを済ませています。
      </p>
    </div>
  );
}
