import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  REVIEW_SCREENING_REASONS,
} from '@revolution/schemas/review';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  REJECTION_REASON_LABELS,
  formatVisitedMonth,
} from '@/lib/reviews/labels';

describe('口コミの画面の言葉', () => {
  it('値の一覧と同じ順・同じ数の言葉がある (DB の値を足したら、ここも足す)', () => {
    expect(Object.keys(ATTENDANCE_LABELS)).toEqual([...REVIEW_ATTENDANCES]);
    expect(Object.keys(FOOD_COST_BAND_LABELS)).toEqual([...REVIEW_FOOD_COST_BANDS]);
    expect(Object.keys(GOODS_COST_BAND_LABELS)).toEqual([...REVIEW_GOODS_COST_BANDS]);
    expect(Object.keys(REJECTION_REASON_LABELS)).toEqual([...REVIEW_SCREENING_REASONS]);
  });
});

describe('formatVisitedMonth', () => {
  it.each([
    ['2026-07', '2026年7月'],
    ['2026-11', '2026年11月'],
  ])('%s → %s', (input, expected) => {
    expect(formatVisitedMonth(input)).toBe(expected);
  });
});
