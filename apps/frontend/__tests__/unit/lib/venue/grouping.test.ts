import { describe, expect, it } from '@jest/globals';

import type { VenueOccurrence } from '@/lib/venue/contracts';
import { groupVenueOccurrencesByStatus } from '@/lib/venue/grouping';

/**
 * `lib/venue/grouping.ts` (Layer 1)。
 *
 * `lib/event/grouping.ts` と同じ状態順・空グループ除外を守りつつ、
 * タイブレークが**企画名** (venueName ではない) であることを固定する。
 */

let nextId = 1;

function occurrence(overrides: Partial<VenueOccurrence>): VenueOccurrence {
  return {
    id: nextId++,
    eventId: 1,
    slug: 'box-cafe-and-space-gems-shibuya',
    startsOn: '2026-04-10',
    endsOn: '2026-08-02',
    status: 'ongoing',
    events: null,
    eventName: '名探偵コナン カフェ',
    ...overrides,
  };
}

describe('groupVenueOccurrencesByStatus', () => {
  it('状態グループを 開催中 → 開催予定 → 日程未発表 → 終了 → 中止 の順で返す', () => {
    const groups = groupVenueOccurrencesByStatus([
      occurrence({ status: 'cancelled' }),
      occurrence({ status: 'ended' }),
      occurrence({ status: 'unscheduled', startsOn: null }),
      occurrence({ status: 'scheduled' }),
      occurrence({ status: 'ongoing' }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      'ongoing',
      'scheduled',
      'unscheduled',
      'ended',
      'cancelled',
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      '開催中',
      '開催予定',
      '日程未発表',
      '終了',
      '中止',
    ]);
  });

  it('空のグループは返さない (見出しだけのセクションを出さない)', () => {
    const groups = groupVenueOccurrencesByStatus([occurrence({ status: 'ongoing' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('ongoing');
  });

  it('開催中は終了が近い順、終了日 null (常設) は末尾', () => {
    const groups = groupVenueOccurrencesByStatus([
      occurrence({ status: 'ongoing', endsOn: null, eventName: '常設' }),
      occurrence({ status: 'ongoing', endsOn: '2026-12-01', eventName: '遠い' }),
      occurrence({ status: 'ongoing', endsOn: '2026-09-01', eventName: '近い' }),
    ]);

    expect(groups[0]?.items.map((item) => item.eventName)).toEqual(['近い', '遠い', '常設']);
  });

  it('開催予定は開始が早い順', () => {
    const groups = groupVenueOccurrencesByStatus([
      occurrence({ status: 'scheduled', startsOn: '2026-10-01', eventName: '後' }),
      occurrence({ status: 'scheduled', startsOn: '2026-09-01', eventName: '先' }),
    ]);

    expect(groups[0]?.items.map((item) => item.eventName)).toEqual(['先', '後']);
  });

  it('日程未発表・中止は日付でなく企画名順 (中止が ends_on を持っても無視)', () => {
    const groups = groupVenueOccurrencesByStatus([
      occurrence({ status: 'cancelled', endsOn: '2026-01-01', eventName: 'ん企画' }),
      occurrence({ status: 'cancelled', endsOn: '2026-12-31', eventName: 'あ企画' }),
    ]);

    expect(groups[0]?.items.map((item) => item.eventName)).toEqual(['あ企画', 'ん企画']);
  });

  it('同着は企画名 → id でタイブレークする (venueName は使わない)', () => {
    const groups = groupVenueOccurrencesByStatus([
      occurrence({ id: 20, status: 'ongoing', endsOn: '2026-09-01', eventName: '同名企画' }),
      occurrence({ id: 10, status: 'ongoing', endsOn: '2026-09-01', eventName: '同名企画' }),
      occurrence({ id: 30, status: 'ongoing', endsOn: '2026-09-01', eventName: 'あ企画' }),
    ]);

    expect(groups[0]?.items.map((item) => item.id)).toEqual([30, 10, 20]);
  });
});
