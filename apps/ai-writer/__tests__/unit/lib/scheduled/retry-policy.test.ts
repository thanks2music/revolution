/**
 * Layer 1: when a URL is tried again and when it is given up (decided 2026-11-15).
 */
import { describe, expect, it } from '@jest/globals';

import { nextAttemptState, type PreviousAttempt } from '@/lib/scheduled/retry-policy';
import { startOfJstDay } from '@/lib/utils/date';

const day = (iso: string) => new Date(`${iso}T03:00:00Z`); // noon in Japan
const NOW = day('2026-11-15');

function previousAfter(first: string, unannouncedCount: number, failureCount = 0, eventStartDate?: string): PreviousAttempt {
  return { firstAttemptAt: day(first), unannouncedCount, failureCount, eventStartDate };
}

describe('PR and ordinary skips end the URL', () => {
  it.each([{ kind: 'pr' as const }, { kind: 'skipped' as const }])('%p → done, never again', outcome => {
    expect(nextAttemptState(undefined, outcome, NOW, day('2026-11-14'))).toMatchObject({
      status: 'done',
      nextAttemptAt: null,
    });
  });
});

describe('details not announced yet', () => {
  it('a page under 7 days old: first retry a week later', () => {
    const state = nextAttemptState(undefined, { kind: 'unannounced' }, NOW, day('2026-11-12'));
    expect(state).toMatchObject({ status: 'waiting-details', unannouncedCount: 1 });
    expect(state.nextAttemptAt).toEqual(day('2026-11-22'));
  });

  it('a page under 7 days old: then every 3 days', () => {
    const state = nextAttemptState(previousAfter('2026-11-08', 1), { kind: 'unannounced' }, NOW, day('2026-11-05'));
    expect(state.nextAttemptAt).toEqual(day('2026-11-18'));
    expect(state.unannouncedCount).toBe(2);
  });

  it('a page 7 days or older when first tried: every 3 days from the start', () => {
    const state = nextAttemptState(undefined, { kind: 'unannounced' }, NOW, day('2026-11-01'));
    expect(state.nextAttemptAt).toEqual(day('2026-11-18'));
  });

  it('stops at the start date: no try on or after it', () => {
    const state = nextAttemptState(undefined, { kind: 'unannounced', eventStartDate: '2026-11-20' }, NOW, day('2026-11-12'));
    expect(state).toMatchObject({ status: 'given-up', nextAttemptAt: null, eventStartDate: '2026-11-20' });
    expect(state.givenUpReason).toContain('2026-11-20');
  });

  it('keeps trying while the start date is after the next try', () => {
    const state = nextAttemptState(undefined, { kind: 'unannounced', eventStartDate: '2026-12-20' }, NOW, day('2026-11-12'));
    expect(state).toMatchObject({ status: 'waiting-details', eventStartDate: '2026-12-20' });
  });

  it('without a start date, stops 60 days after the page was published', () => {
    const state = nextAttemptState(previousAfter('2026-10-01', 5), { kind: 'unannounced' }, NOW, day('2026-09-18'));
    // next try 2026-11-18 is on/after 2026-09-18 + 60 days (2026-11-17)
    expect(state).toMatchObject({ status: 'given-up' });
    expect(state.givenUpReason).toContain('60 日');
  });

  it('switches to a start date that becomes known later', () => {
    const state = nextAttemptState(previousAfter('2026-11-01', 2, 0, '2026-11-17'), { kind: 'unannounced' }, NOW, day('2026-10-30'));
    expect(state).toMatchObject({ status: 'given-up', eventStartDate: '2026-11-17' });
  });
});

describe('failures', () => {
  it('tries again on the next run and counts the failure', () => {
    const state = nextAttemptState(undefined, { kind: 'failure', counted: true }, NOW, NOW);
    expect(state).toMatchObject({ status: 'retrying-failure', failureCount: 1 });
    expect(state.nextAttemptAt).toEqual(NOW);
  });

  it('gives up at the third counted failure', () => {
    const state = nextAttemptState(previousAfter('2026-11-14', 0, 2), { kind: 'failure', counted: true }, NOW, NOW);
    expect(state).toMatchObject({ status: 'given-up', failureCount: 3, nextAttemptAt: null });
  });

  it('a failure during an outage does not count', () => {
    const state = nextAttemptState(previousAfter('2026-11-14', 0, 2), { kind: 'failure', counted: false }, NOW, NOW);
    expect(state).toMatchObject({ status: 'retrying-failure', failureCount: 2 });
  });

  it('only the first failure of a streak is excused, so URLs that always fail are still given up', () => {
    const previous = { ...previousAfter('2026-11-14', 0, 2), lastOutcome: 'failure' as const };
    const state = nextAttemptState(previous, { kind: 'failure', counted: false }, NOW, NOW);
    expect(state).toMatchObject({ status: 'given-up', failureCount: 3 });
  });
});

describe('startOfJstDay', () => {
  it('is midnight in Japan', () => {
    expect(startOfJstDay('2026-11-20')?.toISOString()).toBe('2026-11-19T15:00:00.000Z');
  });
  it('rejects anything but YYYY-MM-DD', () => {
    expect(startOfJstDay('2026/11/20')).toBeUndefined();
  });
});
