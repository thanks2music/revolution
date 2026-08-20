import { describe, expect, it } from '@jest/globals';

import {
  EVENT_NAME_FALLBACK,
  toVenueOccurrences,
  VenueDetailSchema,
} from '@/lib/venue/contracts';

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
  events: { id: 3, name: '名探偵コナン カフェ' },
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
  it('埋め込んだ企画から eventName を解決する', () => {
    const [row] = toVenueOccurrences([occurrenceRow]);
    expect(row?.eventName).toBe('名探偵コナン カフェ');
    expect(row?.eventId).toBe(3);
  });

  it('events が null でも落ちず、slug で代用せずフォールバック文言を使う', () => {
    const [row] = toVenueOccurrences([{ ...occurrenceRow, events: null }]);
    expect(row?.eventName).toBe(EVENT_NAME_FALLBACK);
    expect(row?.eventName).not.toBe(occurrenceRow.slug);
  });

  it('data が undefined なら空配列 (parse で落とさない)', () => {
    expect(toVenueOccurrences(undefined)).toEqual([]);
  });
});
