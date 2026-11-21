import { reviewBlockReason, visitDateRange } from '@/lib/reviews/eligibility';

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

describe('visitDateRange', () => {
  it('開催中は開始日から今日まで', () => {
    expect(visitDateRange('2026-11-01', '2026-12-31', '2026-11-22')).toEqual({
      min: '2026-11-01',
      max: '2026-11-22',
    });
  });

  it('終了した開催は開始日から終了日まで', () => {
    expect(visitDateRange('2026-10-01', '2026-10-31', '2026-11-22')).toEqual({
      min: '2026-10-01',
      max: '2026-10-31',
    });
  });

  it('終了日が無ければ今日まで', () => {
    expect(visitDateRange('2026-11-01', null, '2026-11-22')).toEqual({
      min: '2026-11-01',
      max: '2026-11-22',
    });
  });

  it('開始日が今日の時は今日だけ', () => {
    expect(visitDateRange('2026-11-22', '2026-12-31', '2026-11-22')).toEqual({
      min: '2026-11-22',
      max: '2026-11-22',
    });
  });

  it('開始日が無い・今日より後なら範囲が無い', () => {
    expect(visitDateRange(null, '2026-12-31', '2026-11-22')).toBeNull();
    expect(visitDateRange('2026-11-23', '2026-12-31', '2026-11-22')).toBeNull();
  });
});
