import {
  parseRecent,
  pushRecent,
  RECENT_OCCURRENCES_LIMIT,
} from '@/lib/reviews/recent-occurrences';

describe('最近見た開催', () => {
  it('新しく見た開催を先頭に足し、同じ開催は前の位置から外す', () => {
    expect(pushRecent([1, 2, 3], 2)).toEqual([2, 1, 3]);
    expect(pushRecent([], 5)).toEqual([5]);
  });

  it('上限を超えた古い物は捨てる', () => {
    const ids = Array.from({ length: RECENT_OCCURRENCES_LIMIT }, (_, i) => i + 1);
    expect(pushRecent(ids, 99)).toHaveLength(RECENT_OCCURRENCES_LIMIT);
    expect(pushRecent(ids, 99)[0]).toBe(99);
  });

  it('壊れた値・正でない ID は捨てる', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('[3, -1, 2.5, "4", 7]')).toEqual([3, 7]);
  });
});
