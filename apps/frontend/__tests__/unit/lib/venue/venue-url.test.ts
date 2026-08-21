import { describe, expect, it } from '@jest/globals';

import { getVenueUrl } from '@/lib/venue/venue-url';

/**
 * `lib/venue/venue-url.ts` (Layer 1)。
 *
 * URL 設計 (`docs/event-review-data-model.md` §7) の正準形を固定する。
 * fixture は実データ由来: `box-cafe-and-space-gems-shibuya` は staging の
 * venues に実在する (2026-08-20 seed)。
 */
describe('venue-url', () => {
  it.each([
    [getVenueUrl('box-cafe-and-space-gems-shibuya'), '/venues/box-cafe-and-space-gems-shibuya'],
    [getVenueUrl('animate-cafe-ikebukuro'), '/venues/animate-cafe-ikebukuro'],
  ])('builds %s', (actual, expected) => {
    expect(actual).toBe(expected);
  });
});
