jest.mock('@/lib/env', () => ({ env: {} }));

import { PublicReviewSchema, averageRating } from '@/lib/reviews/queries';

const toPublicReview = (row: unknown) => PublicReviewSchema.parse(row);

const ROW = {
  id: 1,
  rating: 4,
  body: '楽しかった',
  visited_month: '2026-07-01',
  attendance: 'walk_in' as const,
  food_cost_band: null,
  goods_cost_band: '5000_10000' as const,
  has_spoiler: false,
  edited_at: null,
  profiles: { display_name: 'みかん', username: 'mikan', withdrawn_at: null },
};

describe('averageRating', () => {
  it.each([
    [0, 0, null],
    [4, 1, 4],
    [9, 2, 4.5],
    [13, 3, 4.3],
    [14, 3, 4.7],
  ])('合計 %i・件数 %i → %p', (sum, count, expected) => {
    expect(averageRating(sum, count)).toBe(expected);
  });
});

describe('toPublicReview', () => {
  it('訪問は年月だけにし、投稿者は表示名を出す', () => {
    expect(toPublicReview(ROW)).toMatchObject({ visitedMonth: '2026-07', authorName: 'みかん' });
  });

  it('表示名が無ければユーザー名を出す', () => {
    expect(
      toPublicReview({ ...ROW, profiles: { ...ROW.profiles, display_name: null } }).authorName
    ).toBe('mikan');
  });

  it('退会した会員・見えない会員は名前を出さない (退会済みユーザーとして描く)', () => {
    expect(
      toPublicReview({
        ...ROW,
        profiles: { ...ROW.profiles, withdrawn_at: '2026-11-01T00:00:00Z' },
      }).authorName
    ).toBeNull();
    expect(toPublicReview({ ...ROW, profiles: null }).authorName).toBeNull();
  });
});
