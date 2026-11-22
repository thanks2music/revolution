import { barPercent, mostCommon, toReviewStats, totalOf } from '@/lib/reviews/stats';

describe('toReviewStats', () => {
  it('次元ごとに定義の順で並べ、0 件も含める。知らない値は捨てる', () => {
    const stats = toReviewStats([
      { dimension: 'rating', value: '5', count: 2 },
      { dimension: 'rating', value: '1', count: 1 },
      { dimension: 'attendance', value: 'queue', count: 3 },
      { dimension: 'attendance', value: 'teleport', count: 9 },
      { dimension: 'goods_cost_band', value: 'none', count: 1 },
    ]);

    expect(stats.rating).toEqual([
      { value: '5', count: 2 },
      { value: '4', count: 0 },
      { value: '3', count: 0 },
      { value: '2', count: 0 },
      { value: '1', count: 1 },
    ]);
    expect(stats.attendance.map(bar => bar.count)).toEqual([0, 0, 3, 0, 0]);
    expect(totalOf(stats.attendance)).toBe(3);
    expect(totalOf(stats.foodCostBand)).toBe(0);
    expect(stats.goodsCostBand[0]).toEqual({ value: 'none', count: 1 });
  });
});

describe('mostCommon', () => {
  it('いちばん多い値を返し、同数なら先の物、回答が無ければ null', () => {
    expect(
      mostCommon([
        { value: 'a', count: 1 },
        { value: 'b', count: 3 },
      ])
    ).toBe('b');
    expect(
      mostCommon([
        { value: 'a', count: 2 },
        { value: 'b', count: 2 },
      ])
    ).toBe('a');
    expect(mostCommon([{ value: 'a', count: 0 }])).toBeNull();
  });
});

describe('barPercent', () => {
  it('いちばん多い値を 100 にした割合。全部 0 なら 0', () => {
    const items = [{ count: 4 }, { count: 2 }, { count: 0 }];
    expect(barPercent(4, items)).toBe(100);
    expect(barPercent(2, items)).toBe(50);
    expect(barPercent(0, [{ count: 0 }])).toBe(0);
  });
});
