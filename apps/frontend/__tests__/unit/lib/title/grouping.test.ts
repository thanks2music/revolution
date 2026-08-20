import { describe, expect, it } from '@jest/globals';

import type { Occurrence } from '@/lib/occurrence/queries';
import type { TitleEvent } from '@/lib/title/contracts';
import { buildTitleEventGroups } from '@/lib/title/grouping';

/**
 * `lib/title/grouping.ts` (Layer 1) — 作品ハブの企画グルーピングと並び順。
 *
 * ## 何を固定したいか
 *
 * - **公開済み開催を持たない企画が黙って混ざらない**こと (空ページへリンクしない)
 * - 並びが「今行けるものを先に → 終了が新しい順」であること
 *   (`docs/event-review-data-model.md` §4.4 の `max(ends_on) desc` を状態優先と
 *   組み合わせた形)。常設 (`ends_on = null`) は「まだ終わっていない」ので先頭側。
 */

function event(id: number, name: string): TitleEvent {
  return { id, slug: `event-${id}`, name, ratingCount: 0 };
}

function occ(
  eventId: number,
  status: Occurrence['status'],
  endsOn: string | null = null,
): Occurrence {
  return {
    id: eventId * 100 + Math.abs(endsOn ? Number(endsOn.slice(8, 10)) : 0),
    eventId,
    venueLabel: null,
    slug: `venue-${eventId}`,
    startsOn: null,
    endsOn,
    status,
    venues: null,
    venueName: null,
  };
}

describe('buildTitleEventGroups', () => {
  it('drops events without published occurrences (no links to empty pages)', () => {
    const groups = buildTitleEventGroups(
      [event(1, '開催あり'), event(2, '開催なし')],
      [occ(1, 'ongoing', '2026-09-30')],
    );
    expect(groups.map((g) => g.event.id)).toEqual([1]);
  });

  it('orders by representative status: ongoing → scheduled → unscheduled → ended → cancelled', () => {
    const groups = buildTitleEventGroups(
      [event(1, '終了'), event(2, '中止'), event(3, '開催中'), event(4, '日程未発表'), event(5, '予定')],
      [
        occ(1, 'ended', '2026-05-01'),
        occ(2, 'cancelled'),
        occ(3, 'ongoing', '2026-09-30'),
        occ(4, 'unscheduled'),
        occ(5, 'scheduled', '2026-12-01'),
      ],
    );
    expect(groups.map((g) => g.event.id)).toEqual([3, 5, 4, 1, 2]);
  });

  it('uses the most "reachable" occurrence as the representative status', () => {
    // 終了済みの開催があっても、1 会場でも開催中なら企画としては「開催中」扱い。
    const groups = buildTitleEventGroups(
      [event(1, '半分終了'), event(2, '全部予定')],
      [
        occ(1, 'ended', '2026-05-01'),
        occ(1, 'ongoing', '2026-09-30'),
        occ(2, 'scheduled', '2026-12-01'),
      ],
    );
    expect(groups.map((g) => g.event.id)).toEqual([1, 2]);
  });

  it('breaks ties by latest end date, treating open-ended (null) as the newest', () => {
    const groups = buildTitleEventGroups(
      [event(1, '古い終了'), event(2, '新しい終了'), event(3, '常設')],
      [
        occ(1, 'ended', '2026-03-01'),
        occ(2, 'ended', '2026-06-01'),
        // 常設 = ended グループではなく ongoing だが、ここでは同状態同士の
        // タイブレークを見るため全部 ended にして null だけ変える…はできない
        // (null の ends_on で ended は導出上あり得ない)。ongoing 同士で確認する。
      ],
    );
    expect(groups.map((g) => g.event.id)).toEqual([2, 1]);

    const ongoing = buildTitleEventGroups(
      [event(4, '終了日あり'), event(5, '常設')],
      [occ(4, 'ongoing', '2026-09-30'), occ(5, 'ongoing', null)],
    );
    expect(ongoing.map((g) => g.event.id)).toEqual([5, 4]);
  });

  it('keeps the input order of occurrences within the same status', () => {
    const first = occ(1, 'ongoing', '2026-09-01');
    const second = occ(1, 'ongoing', '2026-10-01');
    const groups = buildTitleEventGroups([event(1, 'A')], [first, second]);
    expect(groups[0].occurrences).toEqual([first, second]);
  });

  it('puts reachable occurrences before ended ones within a group', () => {
    // 実データ再現 (toy-story-5): starts_on 順だと「終了」が「開催中」より
    // 上に来る。カード内も「今行けるものを先に」で並べ替える。
    const ended = occ(1, 'ended', '2026-08-09');
    const ongoing = occ(1, 'ongoing', '2026-08-23');
    const groups = buildTitleEventGroups([event(1, 'A')], [ended, ongoing]);
    expect(groups[0].occurrences).toEqual([ongoing, ended]);
  });
});
