import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
} from '@revolution/schemas/review';

/**
 * 開催の口コミの集計 (Figma #3 の星の分布 `6:121` と「行った人のデータ」`83:99`、one-more-time #165)。
 * DB の集計のビュー (`occurrence_review_stats`、公開中の口コミだけ) の行を、画面の形にする。
 */
export type StatRow = { dimension: string; value: string; count: number };

export type StatBar<T extends string> = { value: T; count: number };

export type ReviewStats = {
  /** 星 5 → 1 の順 */
  rating: StatBar<'5' | '4' | '3' | '2' | '1'>[];
  attendance: StatBar<(typeof REVIEW_ATTENDANCES)[number]>[];
  foodCostBand: StatBar<(typeof REVIEW_FOOD_COST_BANDS)[number]>[];
  goodsCostBand: StatBar<(typeof REVIEW_GOODS_COST_BANDS)[number]>[];
};

/** 費用は、項目ごとに回答がこの件数そろうまで出さない (1 人の金額が分からないように、仕様 #156) */
export const COST_MIN_ANSWERS = 3;

const RATING_ORDER = ['5', '4', '3', '2', '1'] as const;

function bars<T extends string>(
  rows: StatRow[],
  dimension: string,
  order: readonly T[]
): StatBar<T>[] {
  const counts = new Map(
    rows.filter(row => row.dimension === dimension).map(row => [row.value, row.count])
  );
  // 値は定義の順に、0 件も含めて並べる (知らない値は捨てる)
  return order.map(value => ({ value, count: counts.get(value) ?? 0 }));
}

export function toReviewStats(rows: StatRow[]): ReviewStats {
  return {
    rating: bars(rows, 'rating', RATING_ORDER),
    attendance: bars(rows, 'attendance', REVIEW_ATTENDANCES),
    foodCostBand: bars(rows, 'food_cost_band', REVIEW_FOOD_COST_BANDS),
    goodsCostBand: bars(rows, 'goods_cost_band', REVIEW_GOODS_COST_BANDS),
  };
}

export function totalOf(items: { count: number }[]): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

/** いちばん多い値 (同数なら定義の順で先の物)。回答が無ければ null */
export function mostCommon<T extends string>(items: StatBar<T>[]): T | null {
  let best: StatBar<T> | null = null;
  for (const item of items) if (item.count > 0 && (!best || item.count > best.count)) best = item;
  return best?.value ?? null;
}

/** 棒の長さ (0〜100 の割合)。いちばん多い値を 100 にする */
export function barPercent(count: number, items: { count: number }[]): number {
  const max = Math.max(0, ...items.map(item => item.count));
  return max === 0 ? 0 : Math.round((count / max) * 100);
}
