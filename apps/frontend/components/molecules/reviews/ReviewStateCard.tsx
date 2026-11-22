/**
 * 開催のページの「口コミの状態」(Figma 追加画面 `93:196`、one-more-time #166)。
 * - notYet: 開催前。始まると書けること (いつから書けるか)
 * - empty: 開催中・終了で 0 件。最初の口コミを書く
 * - ended: 終了した開催 (口コミあり)。終わった後も書ける
 * 中止・日程未発表には出さない (評価の欄ごと出さない。`reviewSectionMode`)。
 */

import Link from 'next/link';

import { toDotDate } from '@/lib/date';

export type ReviewStateKind = 'notYet' | 'empty' | 'ended';

const CARDS = {
  notYet: { title: '開催が始まると口コミを書けます', tone: 'bg-muted/60' },
  empty: { title: 'まだ口コミはありません', tone: 'bg-primary-50' },
  ended: { title: '終わった開催にも口コミを書けます', tone: 'bg-accent-yellow/15' },
} as const satisfies Record<ReviewStateKind, { title: string; tone: string }>;

export function ReviewStateCard(props: {
  kind: ReviewStateKind;
  startsOn: string | null;
  reviewPath: string;
}) {
  const card = CARDS[props.kind];
  const note =
    props.kind === 'notYet'
      ? `${props.startsOn ? `${toDotDate(props.startsOn)} から書けます。` : ''}日程未発表・中止の開催には書けません`
      : props.kind === 'empty'
        ? '行った人の最初の口コミを書きませんか'
        : '行った体験を残すと、次に行くファンの手がかりになります';
  return (
    <div
      data-testid="review-state"
      data-kind={props.kind}
      className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-4 text-center ${card.tone}`}
    >
      <p className="text-sm font-bold text-ink-strong">{card.title}</p>
      <p className="text-[11px] text-ink-muted">{note}</p>
      {props.kind !== 'notYet' && (
        <Link
          href={props.reviewPath}
          className="mt-2 rounded-xl bg-primary-strong px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-strong-hover"
        >
          口コミを書く
        </Link>
      )}
    </div>
  );
}

/** 開催の状態と件数から、出す状態を選ぶ (開催中で口コミがある時は、大きな「口コミを書く」だけを出すので null) */
export function reviewStateKind(input: {
  mode: 'full' | 'notYet';
  occurrenceStatus: string;
  ratingCount: number;
}): ReviewStateKind | null {
  if (input.mode === 'notYet') return 'notYet';
  if (input.ratingCount === 0) return 'empty';
  return input.occurrenceStatus === 'ended' ? 'ended' : null;
}
