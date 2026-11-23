import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  REVIEW_REPORT_REASONS,
} from '@revolution/schemas/review';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  REPORT_REASON_LABELS,
  REVIEW_REASON_LABELS,
  formatVisitedMonth,
  toExplainedReason,
} from '@revolution/reviews/labels';

describe('口コミの画面の言葉', () => {
  it('値の一覧と同じ順・同じ数の言葉がある (DB の値を足したら、ここも足す)', () => {
    expect(Object.keys(ATTENDANCE_LABELS)).toEqual([...REVIEW_ATTENDANCES]);
    expect(Object.keys(FOOD_COST_BAND_LABELS)).toEqual([...REVIEW_FOOD_COST_BANDS]);
    expect(Object.keys(GOODS_COST_BAND_LABELS)).toEqual([...REVIEW_GOODS_COST_BANDS]);
    expect(Object.keys(REVIEW_REASON_LABELS)).toEqual([...REVIEW_REPORT_REASONS]);
    expect(Object.keys(REPORT_REASON_LABELS)).toEqual([...REVIEW_REPORT_REASONS]);
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

describe('toExplainedReason', () => {
  it('審査の 4 種と通報で足した 4 種を通し、AI の失敗と空は null にする', () => {
    expect(toExplainedReason('resale')).toBe('resale');
    expect(toExplainedReason('not_attended')).toBe('not_attended');
    expect(toExplainedReason('ai_failure')).toBeNull();
    expect(toExplainedReason(null)).toBeNull();
  });
});
