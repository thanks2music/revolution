import { describe, expect, it } from '@jest/globals';

import { getEventUrl, getOccurrenceUrl } from '@/lib/event/event-url';

/**
 * URL の正準形を 1 箇所に固定する。
 *
 * `lib/route-params.ts` の `parseCanonicalId` が「正準形は 1 つだけであるべき」
 * という立場を取っている以上、**生成側にも正準形の定義が必要**。
 * これが無いと、読み取り側だけ厳しくて生成側は各ページの裁量、という
 * 非対称になる (実際 8 箇所にテンプレートリテラルが散っていた)。
 */
describe('getEventUrl', () => {
  it('builds /events/{id}', () => {
    expect(getEventUrl(2)).toBe('/events/2');
  });

  it('accepts a string id (route params are strings)', () => {
    expect(getEventUrl('2')).toBe('/events/2');
  });

  it('does not expose events.slug', () => {
    // 企画名は続報で表記が揺れるため slug も揺れる。URL に載せると正準 URL が
    // 変わるので、ID を正準にする (2026-08-03 確定)。
    expect(getEventUrl(2)).not.toContain('slug');
  });
});

describe('getOccurrenceUrl', () => {
  it('builds /events/{id}/{occurrence-slug}', () => {
    expect(getOccurrenceUrl(2, 'tokyo-shibuya')).toBe('/events/2/tokyo-shibuya');
  });

  it('accepts a string id', () => {
    expect(getOccurrenceUrl('2', 'tokyo-shibuya')).toBe('/events/2/tokyo-shibuya');
  });

  it('nests under the event url (the occurrence slug is only unique within an event)', () => {
    // `unique(event_id, slug)` なので、企画 ID と組で初めて開催を特定できる。
    // パンくずが「企画 → 開催」の階層を持てるのはこの入れ子が前提。
    expect(getOccurrenceUrl(2, 'tokyo-shibuya').startsWith(`${getEventUrl(2)}/`)).toBe(true);
  });
});
