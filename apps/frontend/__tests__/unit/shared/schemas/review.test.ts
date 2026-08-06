import { describe, expect, it } from '@jest/globals';

import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  ReviewHelpfulInsertSchema,
  ReviewImageInsertSchema,
  ReviewInsertSchema,
  ReviewSoftDeleteSchema,
  ReviewUpdateSchema,
} from '@revolution/schemas/review';

// profiles.id は `gen_random_uuid()` (= v4) 由来。zod の `uuid()` は version /
// variant のニブルまで検証するため、テストでも実際に生成されうる v4 を使う。
// (Postgres 側の uuid 型は version を検証しないので、ここは Layer 1 の方が厳しい)
const USER_ID = '3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

const base = {
  occurrenceId: 1,
  userId: USER_ID,
  rating: 5,
};

describe('ReviewInsertSchema', () => {
  it('accepts the minimal shape (occurrence_id + user_id + rating)', () => {
    expect(() => ReviewInsertSchema.parse(base)).not.toThrow();
  });

  it('accepts body + visited_on', () => {
    expect(() =>
      ReviewInsertSchema.parse({ ...base, body: 'とても良かった', visitedOn: '2026-08-15' }),
    ).not.toThrow();
  });

  it('accepts body = null and visited_on = null', () => {
    expect(() =>
      ReviewInsertSchema.parse({ ...base, body: null, visitedOn: null }),
    ).not.toThrow();
  });

  it.each([REVIEW_RATING_MIN, 2, 3, 4, REVIEW_RATING_MAX])('accepts rating %i', (rating) => {
    expect(() => ReviewInsertSchema.parse({ ...base, rating })).not.toThrow();
  });

  it.each([
    ['below the minimum', 0],
    ['negative', -1],
    ['above the maximum', 6],
    ['non-integer', 4.5],
  ])('rejects a rating that is %s', (_label, rating) => {
    expect(() => ReviewInsertSchema.parse({ ...base, rating })).toThrow();
  });

  it('rejects a missing rating', () => {
    const { rating: _rating, ...withoutRating } = base;
    expect(() => ReviewInsertSchema.parse(withoutRating)).toThrow();
  });

  it('rejects a whitespace-only body', () => {
    expect(() => ReviewInsertSchema.parse({ ...base, body: '   ' })).toThrow();
  });

  it('rejects a body of only full-width spaces', () => {
    expect(() => ReviewInsertSchema.parse({ ...base, body: '　　' })).toThrow();
  });

  it('rejects a non-ISO visited_on', () => {
    expect(() => ReviewInsertSchema.parse({ ...base, visitedOn: '2026/08/15' })).toThrow();
  });

  // `z.iso.date()` は単純な regex と違い暦の妥当性まで見る。
  it.each([
    ['month out of range', '2026-13-01'],
    ['non-existent day for the month', '2026-02-30'],
    ['leap day in a non-leap year', '2026-02-29'],
  ])('rejects a visited_on with %s', (_label, visitedOn) => {
    expect(() => ReviewInsertSchema.parse({ ...base, visitedOn })).toThrow();
  });

  it('rejects a non-uuid user_id', () => {
    expect(() => ReviewInsertSchema.parse({ ...base, userId: 'not-a-uuid' })).toThrow();
  });

  // ★案 A: helpful_count は review_helpful のトリガだけが更新する派生値。
  // DB 側でも authenticated への UPDATE を列単位 GRANT から除外している。
  it('does not expose helpful_count as an input', () => {
    expect(Object.keys(ReviewInsertSchema.shape)).not.toContain('helpfulCount');
  });

  it('drops a helpful_count supplied by the caller instead of trusting it', () => {
    const parsed = ReviewInsertSchema.parse({ ...base, helpfulCount: 9999 });
    expect(parsed).not.toHaveProperty('helpfulCount');
  });

  // 作成直後に削除済みの行を作る用途がないため、insert からは外している。
  it('does not expose deleted_at as an input', () => {
    expect(Object.keys(ReviewInsertSchema.shape)).not.toContain('deletedAt');
  });
});

describe('ReviewUpdateSchema', () => {
  // DB の `grant update (rating, body, visited_on, deleted_at)` と 1:1 に対応させる。
  // deleted_at はソフトデリート専用スキーマ側が持つ。
  it('exposes exactly the columns authenticated may update', () => {
    expect(Object.keys(ReviewUpdateSchema.shape).sort()).toEqual([
      'body',
      'rating',
      'visitedOn',
    ]);
  });

  it('accepts a partial update', () => {
    expect(() => ReviewUpdateSchema.parse({ rating: 3 })).not.toThrow();
  });

  it('accepts an empty update', () => {
    expect(() => ReviewUpdateSchema.parse({})).not.toThrow();
  });

  it('still enforces the rating range', () => {
    expect(() => ReviewUpdateSchema.parse({ rating: 9 })).toThrow();
  });

  it.each(['occurrenceId', 'userId', 'helpfulCount'])(
    'does not allow %s to be updated',
    (field) => {
      expect(Object.keys(ReviewUpdateSchema.shape)).not.toContain(field);
    },
  );
});

describe('ReviewSoftDeleteSchema', () => {
  it('accepts a deletion timestamp', () => {
    expect(() => ReviewSoftDeleteSchema.parse({ deletedAt: new Date() })).not.toThrow();
  });

  it('accepts null so a review can be restored', () => {
    expect(() => ReviewSoftDeleteSchema.parse({ deletedAt: null })).not.toThrow();
  });

  it('requires the field to be present', () => {
    expect(() => ReviewSoftDeleteSchema.parse({})).toThrow();
  });
});

describe('ReviewImageInsertSchema', () => {
  const image = { reviewId: 1, objectKey: 'reviews/1/abc.webp' };

  it('accepts an R2 object key', () => {
    expect(() => ReviewImageInsertSchema.parse(image)).not.toThrow();
  });

  it('accepts an explicit sort_order', () => {
    expect(() => ReviewImageInsertSchema.parse({ ...image, sortOrder: 3 })).not.toThrow();
  });

  it('rejects a blank object_key', () => {
    expect(() => ReviewImageInsertSchema.parse({ ...image, objectKey: '   ' })).toThrow();
  });

  it('rejects an object_key of only full-width spaces', () => {
    expect(() => ReviewImageInsertSchema.parse({ ...image, objectKey: '　　' })).toThrow();
  });

  it('rejects a missing object_key', () => {
    expect(() => ReviewImageInsertSchema.parse({ reviewId: 1 })).toThrow();
  });

  it.each([
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects a sort_order that is %s', (_label, sortOrder) => {
    expect(() => ReviewImageInsertSchema.parse({ ...image, sortOrder })).toThrow();
  });
});

describe('ReviewHelpfulInsertSchema', () => {
  it('accepts the composite key pair', () => {
    expect(() =>
      ReviewHelpfulInsertSchema.parse({ reviewId: 1, userId: USER_ID }),
    ).not.toThrow();
  });

  it('rejects a missing review_id', () => {
    expect(() => ReviewHelpfulInsertSchema.parse({ userId: USER_ID })).toThrow();
  });

  it('rejects a missing user_id', () => {
    expect(() => ReviewHelpfulInsertSchema.parse({ reviewId: 1 })).toThrow();
  });

  it('rejects a non-uuid user_id', () => {
    expect(() => ReviewHelpfulInsertSchema.parse({ reviewId: 1, userId: 'nope' })).toThrow();
  });
});
