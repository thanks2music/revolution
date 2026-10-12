import { describe, expect, it } from '@jest/globals';

import { rootMetadata } from '@/lib/metadata';

/**
 * docs.anime-events.com は公開するが検索エンジンには載せない (BOSS 決定 2026-10-11)。
 * noindex を外すと黙ってインデックスされ始め、ビルドも画面も変わらないので気づけない。
 * frontend の metadata-title.test.ts と同じ理由で、ここで固定する。
 */
describe('docs サイトの noindex', () => {
  it('root layout は noindex, follow を返す', () => {
    expect(rootMetadata.robots).toEqual({ index: false, follow: true });
  });
});
