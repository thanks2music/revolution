import { reviewStateKind } from '@revolution/reviews/eligibility';

describe('reviewStateKind', () => {
  it('開催前は「始まると書ける」、0 件は「最初の口コミ」、終了は「終わった後も書ける」', () => {
    expect(reviewStateKind('scheduled', 0)).toBe('notYet');
    expect(reviewStateKind('ongoing', 0)).toBe('empty');
    expect(reviewStateKind('ended', 0)).toBe('empty');
    expect(reviewStateKind('ended', 3)).toBe('ended');
  });

  it('中止・日程未発表は出さない', () => {
    expect(reviewStateKind('cancelled', 0)).toBeNull();
    expect(reviewStateKind('unscheduled', 0)).toBeNull();
  });

  it('開催中で口コミがある時は出さない (大きな「口コミを書く」だけ)', () => {
    expect(reviewStateKind('ongoing', 3)).toBeNull();
  });
});
