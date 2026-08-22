import { diffInDays, todayInJst } from '@/lib/occurrence/status';

/**
 * 残日数バッジ (3 段階)。「あと N 日」を出す。
 *
 * ## 出さない条件 (確定仕様)
 *
 * **`ends_on` が null のときは出さない** — 終了日未定 / 常設のケース。
 * 状態バッジだけを表示する。`event-review-data-model.md` §190 および
 * `revolution-er-v3.md` で確定済みで、UI 側の裁量ではない。
 *
 * 併せて、**終了済み (残日数が負) でも出さない**。「あと -3 日」は無意味で、
 * その場合は状態バッジの「終了」が事実を伝えている。
 *
 * ## 3 段階のしきい値
 *
 * デザイン側にステータス色 `days-soon` / `days-urgent` の 2 トークンがあり、
 * これに通常を足して 3 段階になる
 * (`docs/plan/2026-08-02-mvp-design-status-and-remaining-tasks.md` §67)。
 *
 * ⚠️ **境界の日数そのものはデザイン資料に記載が無い**。下記は暫定値で、
 *    デザイン確定時に `DAYS_URGENT_MAX` / `DAYS_SOON_MAX` を差し替える。
 *    色の割り当て自体は確定済みトークンに従っているため、しきい値が動いても
 *    見た目の語彙は壊れない。
 *
 * ## JST 基準
 *
 * `occurrence_view` が JST で状態を導出しているため、残日数も JST 基準で数える
 * (`todayInJst`)。UTC で数えると「開催中なのに残り 0 日」等の食い違いが出る。
 */

/** これ以下は「逼迫」。暫定値 (デザイン未確定)。 */
export const DAYS_URGENT_MAX = 3;
/** これ以下は「まもなく」。暫定値 (デザイン未確定)。 */
export const DAYS_SOON_MAX = 7;

export type RemainingDaysTier = 'urgent' | 'soon' | 'normal';

/** 残日数を 3 段階へ写す。境界値の挙動をテストで固定するため export する。 */
export function toTier(daysLeft: number): RemainingDaysTier {
  if (daysLeft <= DAYS_URGENT_MAX) return 'urgent';
  if (daysLeft <= DAYS_SOON_MAX) return 'soon';
  return 'normal';
}

const tierStyle: Record<RemainingDaysTier, string> = {
  // 前景に ink-strong を使う理由は `styles/globals.css` のトークン定義を参照。
  urgent: 'bg-days-urgent text-ink-strong',
  soon: 'bg-days-soon text-ink-strong',
  normal: 'bg-bg-tinted text-ink-body',
};

type Props = {
  /** `occurrences.ends_on` (`YYYY-MM-DD`)。null / undefined なら何も描画しない。 */
  endsOn: string | null | undefined;
  /** 基準時刻。テストから固定するために注入できる。 */
  now?: Date;
  className?: string;
};

export const RemainingDaysBadge = ({ endsOn, now, className = '' }: Props) => {
  // 終了日未定 / 常設 → 出さない (確定仕様)。
  if (!endsOn) return null;

  const daysLeft = diffInDays(todayInJst(now), endsOn);

  // 終了済み → 出さない。状態バッジの「終了」が事実を伝える。
  if (daysLeft < 0) return null;

  const tier = toTier(daysLeft);

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 font-display text-xs tracking-wide ${tierStyle[tier]} ${className}`}
    >
      <span>あと</span>
      <span className="font-numeric tabular-nums text-base font-bold leading-none">{daysLeft}</span>
      <span>日</span>
    </span>
  );
};
