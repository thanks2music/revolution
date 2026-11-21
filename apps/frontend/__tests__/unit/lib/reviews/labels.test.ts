import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
} from '@revolution/schemas/review';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
} from '@/lib/reviews/labels';

describe('口コミの画面の言葉', () => {
  it('値の一覧と同じ順・同じ数の言葉がある (DB の値を足したら、ここも足す)', () => {
    expect(Object.keys(ATTENDANCE_LABELS)).toEqual([...REVIEW_ATTENDANCES]);
    expect(Object.keys(FOOD_COST_BAND_LABELS)).toEqual([...REVIEW_FOOD_COST_BANDS]);
    expect(Object.keys(GOODS_COST_BAND_LABELS)).toEqual([...REVIEW_GOODS_COST_BANDS]);
  });
});
