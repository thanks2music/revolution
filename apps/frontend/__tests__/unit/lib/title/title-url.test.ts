import { describe, expect, it } from '@jest/globals';

import {
  getTitleArticlesCategoryUrl,
  getTitleArticlesUrl,
  getTitleOccurrencesUrl,
  getTitleUrl,
} from '@/lib/title/title-url';

/**
 * `lib/title/title-url.ts` (Layer 1)。
 *
 * URL 設計 (`docs/event-review-data-model.md` §7) の正準形を固定する。
 * fixture は実データ由来: `jujutsu-kaisen` / `collabo-cafe` は staging の
 * titles / categories に実在する (2026-08-20 実測)。
 */
describe('title-url', () => {
  it.each([
    [getTitleUrl('jujutsu-kaisen'), '/titles/jujutsu-kaisen'],
    [getTitleArticlesUrl('jujutsu-kaisen'), '/titles/jujutsu-kaisen/articles'],
    [
      getTitleArticlesCategoryUrl('jujutsu-kaisen', 'collabo-cafe'),
      '/titles/jujutsu-kaisen/articles/collabo-cafe',
    ],
    [getTitleOccurrencesUrl('jujutsu-kaisen'), '/titles/jujutsu-kaisen/occurrences'],
  ])('builds %s', (actual, expected) => {
    expect(actual).toBe(expected);
  });
});
