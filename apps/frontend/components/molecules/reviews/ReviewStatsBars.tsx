/**
 * 開催の口コミの集計 (Figma #3、one-more-time #165)。
 * - `RatingDistribution`: 星の分布 (5 → 1、`6:121`)。評価の欄の平均の横に置く
 * - `VisitorData`: 行った人のデータ (`83:99`)。参加のしかた・飲食代・グッズ代の帯ごとの人数
 *
 * 数えるのは公開中の口コミだけ (DB の集計のビュー)。費用のグラフは項目ごとに回答が COST_MIN_ANSWERS 件
 * そろうまで出さない (仕様の表示の決まり)。
 */

import {
  ATTENDANCE_SHORT_LABELS,
  ATTENDANCE_SUMMARY_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
} from '@/lib/reviews/labels';
import {
  barPercent,
  COST_MIN_ANSWERS,
  mostCommon,
  totalOf,
  type ReviewStats,
  type StatBar,
} from '@/lib/reviews/stats';

export function RatingDistribution({ bars }: { bars: ReviewStats['rating'] }) {
  return (
    <ul
      aria-label="星の分布"
      className="flex min-w-0 flex-1 flex-col gap-1"
      data-testid="rating-distribution"
    >
      {bars.map(bar => (
        <li key={bar.value} className="flex items-center gap-1 text-[11px] text-ink-muted">
          <span aria-hidden="true" className="w-4 shrink-0">
            {bar.value}
          </span>
          <Bar percent={barPercent(bar.count, bars)} tone="sky" />
          <span aria-hidden="true" className="w-6 shrink-0 text-right">
            {bar.count}
          </span>
          <span className="sr-only">{`星${bar.value}つ ${bar.count}件`}</span>
        </li>
      ))}
    </ul>
  );
}

/** 棒グラフの 1 群 (画面の言葉にした形) */
type BarGroupView = {
  title: string;
  /** いちばん多い値の説明 (例: 並ばずそのまま入った人が最多)。回答が無ければ null */
  summary: string | null;
  items: { key: string; label: string; count: number; percent: number; isTop: boolean }[];
};

function toGroup<T extends string>(
  title: string,
  bars: StatBar<T>[],
  labels: Record<T, string>,
  summary: (topLabel: string) => string,
  /** 説明に使う言葉 (棒の横の言葉より長い時。省けば同じ) */
  summaryLabels: Record<T, string> = labels
): BarGroupView {
  const top = mostCommon(bars);
  return {
    title,
    summary: top ? summary(summaryLabels[top]) : null,
    items: bars.map(bar => ({
      key: bar.value,
      label: labels[bar.value],
      count: bar.count,
      percent: barPercent(bar.count, bars),
      isTop: bar.value === top,
    })),
  };
}

export function VisitorData({ stats, reviewCount }: { stats: ReviewStats; reviewCount: number }) {
  const groups = [
    totalOf(stats.attendance) > 0 &&
      toGroup(
        'どうやって入った?',
        stats.attendance,
        ATTENDANCE_SHORT_LABELS,
        top => `${top}人が最多`,
        ATTENDANCE_SUMMARY_LABELS
      ),
    // 費用は、項目ごとに回答がそろうまで出さない
    totalOf(stats.foodCostBand) >= COST_MIN_ANSWERS &&
      toGroup('飲食代（1人分）', stats.foodCostBand, FOOD_COST_BAND_LABELS, top => `${top} が最多`),
    totalOf(stats.goodsCostBand) >= COST_MIN_ANSWERS &&
      toGroup(
        'グッズ代（1人分）',
        stats.goodsCostBand,
        GOODS_COST_BAND_LABELS,
        top => `${top} が最多`
      ),
  ].filter((group): group is BarGroupView => group !== false);
  if (groups.length === 0) return null;

  return (
    <section
      aria-labelledby="visitor-data-heading"
      data-testid="visitor-data"
      className="flex flex-col gap-3.5 rounded-2xl border border-(--line-soft) bg-primary-50/40 p-4"
    >
      <p className="flex items-center gap-1.5">
        <span id="visitor-data-heading" className="text-[13px] font-bold text-ink-strong">
          行った人のデータ
        </span>
        <span className="text-[11px] text-ink-muted">口コミ{reviewCount}件から</span>
      </p>
      {groups.map(group => (
        <BarGroup key={group.title} group={group} />
      ))}
    </section>
  );
}

function BarGroup({ group }: { group: BarGroupView }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="text-xs font-bold text-ink-strong">{group.title}</span>
        {group.summary && <span className="text-[11px] text-primary-700">{group.summary}</span>}
      </p>
      <ul className="flex flex-col gap-1.5">
        {group.items.map(item => (
          <li key={item.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-32 shrink-0 text-ink-body">{item.label}</span>
            <Bar percent={item.percent} tone={item.isTop ? 'strong' : 'light'} />
            <span className="shrink-0 text-ink-muted">{item.count}人</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONES = { sky: 'bg-primary-500', strong: 'bg-primary-600', light: 'bg-primary-300' } as const;

function Bar({ percent, tone }: { percent: number; tone: keyof typeof TONES }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-(--line-soft)"
    >
      {/* 0 件でも小さな点を残す (Figma の 0人 の行) */}
      <span
        className={`block h-full rounded-[3px] ${TONES[tone]}`}
        style={{ width: `max(2px, ${percent}%)` }}
      />
    </span>
  );
}
