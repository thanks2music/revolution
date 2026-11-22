/**
 * 口コミを書く開催の 1 行 (7-0、Figma `93:130`、one-more-time #166)。
 * 書ける開催は投稿のページへのリンク、書けない開催 (開催前など) は薄く出し、いつから書けるかを添える。
 */

import Link from 'next/link';

import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import { toDotDate } from '@/lib/date';
import { formatPeriod } from '@/lib/occurrence/format';
import { toBadgeStatus } from '@/lib/occurrence/status';
import type { ReviewTarget } from '@/lib/reviews/picker';

export function ReviewTargetItem(props: {
  target: ReviewTarget;
  /** 書いた口コミの行 (「書いた口コミを直す」を添える) */
  ownReview?: boolean;
}) {
  const { target } = props;
  const title = target.venueName ? `${target.eventName} ${target.venueName}` : target.eventName;
  const body = (
    <>
      <StatusBadge status={toBadgeStatus(target.status)} className="self-start text-[11px]" />
      <span className="text-sm font-bold">{title}</span>
      <span className="text-[11px] text-ink-muted">
        {/* 直せない口コミ (中止になった開催の下書きなど) には「直す」を添えない。消すのはマイページから */}
        {props.ownReview && target.canWrite && '書いた口コミを直す ・ '}
        {target.canWrite
          ? formatPeriod(target.startsOn, target.endsOn)
          : target.status === 'scheduled' && target.startsOn
            ? `${toDotDate(target.startsOn)} から書けます`
            : '口コミを書けません'}
      </span>
    </>
  );

  if (!target.canWrite) {
    return (
      <div
        data-testid="review-target"
        aria-disabled="true"
        className="flex flex-col gap-1 py-3 text-ink-muted opacity-60"
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={`${target.occurrencePath}/review`}
      data-testid="review-target"
      className="flex items-center gap-2 py-3 text-ink-strong hover:bg-muted/40"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">{body}</span>
      <span aria-hidden="true" className="text-ink-muted">
        ›
      </span>
    </Link>
  );
}
