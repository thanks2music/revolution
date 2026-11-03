import { describe, expect, it } from '@jest/globals';

import { toVenueOccurrences, VenueDetailSchema } from '@/lib/venue/contracts';

/**
 * `lib/venue/contracts.ts` (Layer 1)。
 *
 * PostgREST が返す形 (select 句の別名で camelCase 済み) を fixture にして、
 * 契約の parse と企画名解決を固定する。fixture は staging 実データ由来
 * (2026-08-20 seed: BOX cafe&space GEMS渋谷店)。
 */

const venueRow = {
  id: 1,
  slug: 'box-cafe-and-space-gems-shibuya',
  name: 'BOX cafe&space GEMS渋谷店',
  prefecture: '東京都',
  city: '渋谷区',
  address: '渋谷区渋谷1-1-1',
};

const occurrenceRow = {
  id: 11,
  eventId: 3,
  slug: 'box-cafe-and-space-gems-shibuya',
  startsOn: '2026-04-10',
  endsOn: '2026-08-02',
  status: 'ongoing',
  events: { id: 3, name: '名探偵コナン カフェ', primaryCategory: { slug: 'collabo-cafe', name: 'コラボカフェ' } },
};

describe('VenueDetailSchema', () => {
  it('会場行を parse する (prefecture / city / address は null を許す)', () => {
    expect(VenueDetailSchema.parse(venueRow)).toEqual(venueRow);
    expect(
      VenueDetailSchema.parse({ ...venueRow, prefecture: null, city: null, address: null }),
    ).toMatchObject({ prefecture: null, city: null, address: null });
  });
});

describe('toVenueOccurrences', () => {
  it('埋め込んだ企画 (名前とリンク先の種別) を解決済みで持つ', () => {
    const [row] = toVenueOccurrences([occurrenceRow]);
    expect(row?.events.name).toBe('名探偵コナン カフェ');
    expect(row?.eventId).toBe(3);
    expect(row?.events.primaryCategory.slug).toBe('collabo-cafe');
  });

  it('events が null の行は落とす (種別が分からずリンク先の URL を作れない)', () => {
    // 種別を URL に入れる前も、企画の無い開催ページは 404 だった。
    const rows = toVenueOccurrences([{ ...occurrenceRow, events: null }, occurrenceRow]);
    expect(rows.map((row) => row.id)).toEqual([occurrenceRow.id]);
  });

  it('企画の主分類が null なら parse で落とす (`/undefined/3/…` を作らない)', () => {
    expect(() =>
      toVenueOccurrences([
        { ...occurrenceRow, events: { ...occurrenceRow.events, primaryCategory: null } },
      ]),
    ).toThrow();
  });

  it('data が undefined なら空配列 (parse で落とさない)', () => {
    expect(toVenueOccurrences(undefined)).toEqual([]);
  });
});
