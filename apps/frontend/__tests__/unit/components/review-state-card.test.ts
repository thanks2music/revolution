import { reviewStateKind } from '@/components/molecules/reviews/ReviewStateCard';

describe('reviewStateKind', () => {
  it('開催前は「始まると書ける」、0 件は「最初の口コミ」、終了は「終わった後も書ける」', () => {
    expect(reviewStateKind({ mode: 'notYet', occurrenceStatus: 'scheduled', ratingCount: 0 })).toBe(
      'notYet'
    );
    expect(reviewStateKind({ mode: 'full', occurrenceStatus: 'ongoing', ratingCount: 0 })).toBe(
      'empty'
    );
    expect(reviewStateKind({ mode: 'full', occurrenceStatus: 'ended', ratingCount: 0 })).toBe(
      'empty'
    );
    expect(reviewStateKind({ mode: 'full', occurrenceStatus: 'ended', ratingCount: 3 })).toBe(
      'ended'
    );
  });

  it('開催中で口コミがある時は出さない (大きな「口コミを書く」だけ)', () => {
    expect(
      reviewStateKind({ mode: 'full', occurrenceStatus: 'ongoing', ratingCount: 3 })
    ).toBeNull();
  });
});
