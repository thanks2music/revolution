/**
 * mergeTitleMappings (Layer 1): 手書きの辞書と自動生成の辞書を合わせる
 */
import { describe, expect, it } from '@jest/globals';

import { mergeTitleMappings } from '@/lib/config/yaml-loader';

describe('mergeTitleMappings', () => {
  it('自動生成の作品を足し、キーが重なれば手書きの作品を使う', () => {
    const merged = mergeTitleMappings(
      { titles: { 作品A: { slug: 'hand-a' }, 作品B: 'hand-b' } },
      { titles: { 作品A: { slug: 'generated-a' }, 作品C: { slug: 'generated-c' } } },
    );
    expect(merged.titles).toEqual({
      作品A: { slug: 'hand-a' },
      作品B: 'hand-b',
      作品C: { slug: 'generated-c' },
    });
  });

  it('自動生成の辞書が空・無いときは手書きのまま', () => {
    const hand = { titles: { 作品A: { slug: 'hand-a' } } };
    expect(mergeTitleMappings(hand, null)).toEqual(hand);
    expect(mergeTitleMappings(hand, {})).toEqual(hand);
  });
});
