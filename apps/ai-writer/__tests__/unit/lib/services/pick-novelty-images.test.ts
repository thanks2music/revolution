/**
 * Layer 1: ノベルティの画像を、ノベルティ名が読めた会場の案内ページから選ぶ (`pick-novelty-images.ts`、2026-10-13)。
 */
import { pickNoveltyImages } from '@/lib/services/pick-novelty-images';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';

const facts = (url: string, kind: SubpageFacts['kind'], ノベルティ名: string[] | null): SubpageFacts => ({
  url,
  kind,
  area: null,
  メニュー詳細リスト: null,
  グッズ詳細リスト: null,
  ノベルティ名,
  キャラクター名: null,
});

describe('pickNoveltyImages', () => {
  const GUIDE = 'https://example.com/lp/guide';
  const TOKYO = 'https://example.com/lp/s004';
  const OSAKA = 'https://example.com/lp/s019';

  it('ノベルティ名が読めた会場のページのうち、候補のある最初のページを選ぶ (ノベルティ名の無いページは使わない)', () => {
    const picked = pickNoveltyImages(
      [
        { url: GUIDE, images: ['https://example.com/step_01.png'] },
        { url: TOKYO, images: ['https://example.com/tokuten-tokyo.jpg'] },
        { url: OSAKA, images: ['https://example.com/tokuten-osaka.jpg'] },
      ],
      [facts(GUIDE, 'venue', null), facts(`${TOKYO}/`, 'venue', ['ホログラムステッカー']), facts(OSAKA, 'venue', ['ホログラムステッカー'])]
    );

    expect(picked).toEqual({ url: TOKYO, images: ['https://example.com/tokuten-tokyo.jpg'] });
  });

  it('ノベルティ名が読めたページに候補が無ければ null (画像を推測で選ばない)', () => {
    expect(
      pickNoveltyImages([{ url: GUIDE, images: ['https://example.com/step_01.png'] }], [facts(TOKYO, 'venue', ['ステッカー'])])
    ).toBeNull();
  });

  it('venue 以外のページ (ノベルティの下層ページなど) の事実は使わない', () => {
    expect(
      pickNoveltyImages([{ url: TOKYO, images: ['https://example.com/a.jpg'] }], [facts(TOKYO, 'menu', ['ステッカー'])])
    ).toBeNull();
  });
});
