'use client';

/**
 * 7-0 の「最近見た開催」と「まだ書けない開催」(one-more-time #166)。
 * 最近見た開催はブラウザに残しているので、マウント後に ID を読み、開催を引いて出す。
 * 書ける開催を「最近見た開催」に、開催前などを「まだ書けない開催」に分ける。
 */

import { useEffect, useState } from 'react';

import { getRecentReviewTargets } from '@/actions/review-targets';
import type { ReviewTarget } from '@/lib/reviews/picker';
import { readRecent } from '@/lib/reviews/recent-occurrences';

import { ReviewTargetItem } from './ReviewTargetItem';

export function RecentReviewTargets(props: {
  /** 「口コミを書いた開催」に出す開催 (ここでは重ねて出さない) */
  excludeIds: number[];
}) {
  const [targets, setTargets] = useState<ReviewTarget[] | null>(null);
  const exclude = props.excludeIds.join(',');

  useEffect(() => {
    let active = true;
    const excluded = new Set(exclude ? exclude.split(',').map(Number) : []);
    const ids = readRecent().filter(id => !excluded.has(id));
    // 0 件でも action を通す (action は空の一覧に空を返す。effect の中で直に state を書かない)
    getRecentReviewTargets(ids)
      .then(result => active && setTargets(result))
      .catch(() => active && setTargets([]));
    return () => {
      active = false;
    };
  }, [exclude]);

  if (!targets || targets.length === 0) return null;
  const writable = targets.filter(target => target.canWrite);
  const notYet = targets.filter(target => !target.canWrite);
  return (
    <>
      {writable.length > 0 && <TargetSection title="最近見た開催" targets={writable} />}
      {notYet.length > 0 && <TargetSection title="まだ書けない開催" targets={notYet} />}
    </>
  );
}

export function TargetSection(props: {
  title: string;
  targets: ReviewTarget[];
  ownReview?: boolean;
}) {
  return (
    <section className="flex flex-col">
      <h2 className="pt-4 text-sm font-bold text-ink-strong">{props.title}</h2>
      <ul className="flex flex-col divide-y divide-(--line-soft)">
        {props.targets.map(target => (
          <li key={target.occurrenceId}>
            <ReviewTargetItem target={target} ownReview={props.ownReview} />
          </li>
        ))}
      </ul>
    </section>
  );
}
