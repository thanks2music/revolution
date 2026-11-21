import { reviewBlockReason } from '@/lib/reviews/eligibility';

describe('reviewBlockReason', () => {
  it.each(['ongoing', 'ended'] as const)('%s の開催には書ける', status => {
    expect(reviewBlockReason(status)).toBeNull();
  });

  it.each(['scheduled', 'unscheduled', 'cancelled'] as const)(
    '%s の開催には書けない理由を返す',
    status => {
      expect(reviewBlockReason(status)).toEqual(expect.any(String));
    }
  );
});
