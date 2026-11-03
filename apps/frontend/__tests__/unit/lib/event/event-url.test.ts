import { describe, expect, it } from '@jest/globals';

import { getEventTypeUrl, getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';

/**
 * URL の正準形を 1 箇所に固定する。
 *
 * `lib/route-params.ts` の `parseCanonicalId` が「正準形は 1 つだけであるべき」
 * という立場を取っている以上、**生成側にも正準形の定義が必要**。
 * これが無いと、読み取り側だけ厳しくて生成側は各ページの裁量、という
 * 非対称になる (実際 8 箇所にテンプレートリテラルが散っていた)。
 *
 * 2026-11-03: 第 1 階層を `/events` から種別 (`categories.slug`) に変えた。
 */
const cafe = { id: 2, primaryCategory: { slug: 'collabo-cafe' } };

describe('getEventTypeUrl', () => {
  it('builds /{種別}', () => {
    expect(getEventTypeUrl('collabo-cafe')).toBe('/collabo-cafe');
  });
});

describe('getEventUrl', () => {
  it('builds /{種別}/{id}', () => {
    expect(getEventUrl(cafe)).toBe('/collabo-cafe/2');
  });

  it('accepts a string id (route params are strings)', () => {
    expect(getEventUrl({ ...cafe, id: '2' })).toBe('/collabo-cafe/2');
  });

  it('uses the primary category as the first segment', () => {
    expect(getEventUrl({ id: 2, primaryCategory: { slug: 'pop-up-store' } })).toBe(
      '/pop-up-store/2',
    );
  });

  it('nests under the type url', () => {
    expect(getEventUrl(cafe).startsWith(`${getEventTypeUrl('collabo-cafe')}/`)).toBe(true);
  });

  it('does not expose events.slug', () => {
    // 企画名は続報で表記が揺れるため slug も揺れる。URL に載せると正準 URL が
    // 変わるので、ID を正準にする (2026-08-03 確定)。埋め込みの行をそのまま
    // 渡したときに events.slug が混ざらないことを確かめる。
    const row = { ...cafe, slug: 'chiikawa-hanten' };
    expect(getEventUrl(row)).not.toContain('chiikawa-hanten');
  });
});

describe('getOccurrenceUrl', () => {
  it('builds /{種別}/{id}/{occurrence-slug}', () => {
    expect(getOccurrenceUrl(cafe, 'tokyo-shibuya')).toBe('/collabo-cafe/2/tokyo-shibuya');
  });

  it('accepts a string id', () => {
    expect(getOccurrenceUrl({ ...cafe, id: '2' }, 'tokyo-shibuya')).toBe(
      '/collabo-cafe/2/tokyo-shibuya',
    );
  });

  it('nests under the event url (the occurrence slug is only unique within an event)', () => {
    // `unique(event_id, slug)` なので、企画 ID と組で初めて開催を特定できる。
    // パンくずが「企画 → 開催」の階層を持てるのはこの入れ子が前提。
    expect(getOccurrenceUrl(cafe, 'tokyo-shibuya').startsWith(`${getEventUrl(cafe)}/`)).toBe(
      true,
    );
  });
});
