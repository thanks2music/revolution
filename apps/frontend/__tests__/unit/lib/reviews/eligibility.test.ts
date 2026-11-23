import {
  authoringMode,
  ownReviewStatus,
  reviewBlockReason,
  reviewSectionMode,
  visitDateRange,
} from '@revolution/reviews/eligibility';

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

describe('reviewSectionMode', () => {
  it.each([
    ['ongoing', 'full'],
    ['ended', 'full'],
    ['scheduled', 'notYet'],
    ['unscheduled', 'none'],
    ['cancelled', 'none'],
  ] as const)('%s → %s', (status, mode) => {
    expect(reviewSectionMode(status)).toBe(mode);
  });
});

describe('ownReviewStatus', () => {
  it.each([
    ['draft', null],
    ['pending', 'screening'],
    ['needs_review', 'screening'],
    ['published', 'published'],
    ['rejected', 'rejected'],
    ['hidden', 'hidden'],
  ] as const)('%s → %p', (status, own) => {
    expect(ownReviewStatus(status)).toBe(own);
  });
});

describe('authoringMode', () => {
  const base = { startsOn: '2026-11-01', endsOn: '2026-11-30', today: '2026-11-22' };

  it('口コミが無ければ新しく書け、下書きがあれば続きになる (選べる日は開始日から今日まで)', () => {
    expect(authoringMode({ ...base, occurrenceStatus: 'ongoing', own: null })).toEqual({
      kind: 'new',
      range: { min: '2026-11-01', max: '2026-11-22' },
    });
    expect(
      authoringMode({
        ...base,
        occurrenceStatus: 'ongoing',
        own: { status: 'draft', visitedOn: null },
      })
    ).toMatchObject({ kind: 'draft' });
  });

  it('中止の開催には、新しく書けず、下書きも続けられない', () => {
    expect(authoringMode({ ...base, occurrenceStatus: 'cancelled', own: null })).toMatchObject({
      kind: 'blocked',
    });
    expect(
      authoringMode({
        ...base,
        occurrenceStatus: 'cancelled',
        own: { status: 'draft', visitedOn: null },
      })
    ).toMatchObject({ kind: 'blocked' });
  });

  it('提出した口コミは、中止になった開催でも直せる (訪問日は前の日に固定する)', () => {
    expect(
      authoringMode({
        ...base,
        occurrenceStatus: 'cancelled',
        own: { status: 'published', visitedOn: '2026-11-03' },
      })
    ).toEqual({ kind: 'edit', range: { min: '2026-11-03', max: '2026-11-03' } });
  });

  it('開催中なら、提出した口コミの訪問日を範囲の中で選び直せる', () => {
    expect(
      authoringMode({
        ...base,
        occurrenceStatus: 'ongoing',
        own: { status: 'rejected', visitedOn: '2026-11-03' },
      })
    ).toEqual({ kind: 'edit', range: { min: '2026-11-01', max: '2026-11-22' } });
  });

  it('選べる日が無くなった開催では、提出した口コミの前の訪問日だけを選べる', () => {
    expect(
      authoringMode({
        startsOn: null,
        endsOn: null,
        today: '2026-11-22',
        occurrenceStatus: 'unscheduled',
        own: { status: 'rejected', visitedOn: '2026-10-05' },
      })
    ).toEqual({ kind: 'edit', range: { min: '2026-10-05', max: '2026-10-05' } });
  });

  it('訪問日の無い提出した口コミ (DB の CHECK で起きない) は、選べる日が無ければ止める', () => {
    expect(
      authoringMode({
        startsOn: null,
        endsOn: null,
        today: '2026-11-22',
        occurrenceStatus: 'unscheduled',
        own: { status: 'published', visitedOn: null },
      })
    ).toMatchObject({ kind: 'blocked' });
  });
});
