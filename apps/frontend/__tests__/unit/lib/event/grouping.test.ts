import { describe, expect, it } from '@jest/globals';
import { OCCURRENCE_STATUS_VALUES } from '@revolution/schemas/occurrence';

import { groupOccurrencesByStatus } from '@/lib/event/grouping';
import type { Occurrence } from '@/lib/occurrence/queries';

const make = (over: Partial<Occurrence>): Occurrence => ({
  id: 1,
  eventId: 2,
  venueLabel: null,
  slug: 'slug',
  startsOn: '2026-08-01',
  endsOn: '2026-09-01',
  status: 'ongoing',
  venues: null,
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

  /**
   * ★ PR #303 レビュー指摘の回帰テスト。
   *
   * 旧実装は `scheduled` 以外をすべて `ends_on` 優先で並べていたため、
   * docstring の「日程未発表 / 中止 = 会場名順」と挙動が乖離していた。
   * **中止は通常 `ends_on` を持ち**、日程未発表も DB CHECK 上は
   * `starts_on is null` + `ends_on` あり を許すので、実データで露出する。
   * 旧テストは両グループを `endsOn: null` のケースしか固定していなかった。
   */
  it('sorts cancelled by venue name even when the occurrences have end dates', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'cancelled', endsOn: '2026-09-30', venueName: 'あ' }),
      make({ id: 2, status: 'cancelled', endsOn: '2026-09-01', venueName: 'い' }),
    ]);
    // ends_on で並べれば ['い', 'あ'] になる。中止に「終了間近順」は意味がない。
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['あ', 'い']);
  });

  it('sorts unscheduled by venue name even when an end date exists', () => {
    const groups = groupOccurrencesByStatus([
      make({ id: 1, status: 'unscheduled', startsOn: null, endsOn: '2026-12-31', venueName: 'あ' }),
      make({ id: 2, status: 'unscheduled', startsOn: null, endsOn: '2026-09-01', venueName: 'い' }),
    ]);
    expect(groups[0].items.map((i) => i.venueName)).toEqual(['あ', 'い']);
  });

  /**
   * 全状態がグループに現れることを固定する。`GROUP_ORDER` から状態が漏れると
   * その開催が「会場を選ぶ」から無言で落ち、件数表示と合計が食い違う。
   * 型でも守っているが、実行時にも押さえる。
   */
  it('assigns every occurrence to some group (nothing silently disappears)', () => {
    const items = OCCURRENCE_STATUS_VALUES.map((status, index) =>
      make({ id: index + 1, status, slug: `slug-${index}` }),
    );
    const groups = groupOccurrencesByStatus(items);
    const grouped = groups.flatMap((g) => g.items);

    expect(grouped).toHaveLength(items.length);
    expect(new Set(grouped.map((i) => i.id))).toEqual(new Set(items.map((i) => i.id)));
  });
});
