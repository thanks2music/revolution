import { describe, expect, it } from '@jest/globals';

import { groupOccurrencesByStatus } from '@/lib/event/grouping';
import type { OccurrenceListItem } from '@/lib/occurrence/queries';

const make = (over: Partial<OccurrenceListItem>): OccurrenceListItem => ({
  id: 1,
  eventId: 2,
  venueId: null,
  venueLabel: null,
  slug: 'slug',
  startsOn: '2026-08-01',
  endsOn: '2026-09-01',
  status: 'ongoing',
  venueName: '会場',
  ...over,
});

describe('groupOccurrencesByStatus', () => {
  it('orders groups so that reachable occurrences come first', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'cancelled' }),
      make({ id: 2, status: 'ended' }),
      make({ id: 3, status: 'unscheduled', startsOn: null, endsOn: null }),
      make({ id: 4, status: 'scheduled' }),
      make({ id: 5, status: 'ongoing' }),
    ]);

    // 「まだ行けるもの」から先に読ませる。終了・中止を上に置かない。
    expect(groups.map((g) => g.key)).toEqual([
      'ongoing',
      'scheduled',
      'unscheduled',
      'ended',
      'cancelled',
    ]);
  });

  it('drops empty groups so the page has no headings without content', () => {
    const groups = groupOccurrencesByStatus([make({ status: 'ongoing' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('ongoing');
  });

  it('returns nothing for an empty input', () => {
    expect(groupOccurrencesByStatus([])).toEqual([]);
  });

  it('sorts ongoing by the closest end date (terminating soonest first)', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'ongoing', endsOn: '2026-09-30', venueName: '遅い' }),
      make({ id: 2, status: 'ongoing', endsOn: '2026-09-01', venueName: '早い' }),
    ]);
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['早い', '遅い']);
  });

  it('sorts scheduled by the earliest start date', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'scheduled', startsOn: '2026-10-01', venueName: '後' }),
      make({ id: 2, status: 'scheduled', startsOn: '2026-09-01', venueName: '先' }),
    ]);
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['先', '後']);
  });

  it('puts an open-ended occurrence last instead of first', () => {
    // `ends_on = null` は「終了日未定 / 常設」。null を 0 や Infinity に潰すと
    // 常設が先頭に来たり順序が不安定になる。
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'ongoing', endsOn: null, venueName: '常設' }),
      make({ id: 2, status: 'ongoing', endsOn: '2026-09-01', venueName: '期間限定' }),
    ]);
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['期間限定', '常設']);
  });

  it('falls back to venue name so the order is stable across runs', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'unscheduled', startsOn: null, endsOn: null, venueName: 'び' }),
      make({ id: 2, status: 'unscheduled', startsOn: null, endsOn: null, venueName: 'あ' }),
    ]);
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['あ', 'び']);
  });
});
