/**
 * Layer 1: ノベルティの画像を、ノベルティ名が読めた会場の案内ページから選ぶ (`pick-novelty-images.ts`、2026-10-13)。
 */
import type { CategoryImages } from '@/lib/services/category-image-extractor.service';
import { pickNoveltyImages, venueUrlsWithNovelties, withNoveltyImagesFromVenues } from '@/lib/services/pick-novelty-images';
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

describe('venueUrlsWithNovelties', () => {
  it('ノベルティ名が読めた会場のページだけを、末尾の / を無視したキーで返す (下層ページ・名前の無いページは含めない)', () => {
    const urls = venueUrlsWithNovelties([
      facts('https://example.com/lp/s004/', 'venue', ['ステッカー']),
      facts('https://example.com/lp/guide', 'venue', null),
      facts('https://example.com/novelty', 'novelty', ['ステッカー']),
    ]);
    expect([...urls]).toEqual(['https://example.com/lp/s004']);
  });
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

describe('withNoveltyImagesFromVenues', () => {
  const TOKYO = 'https://example.com/lp/s004';
  const base = (novelty: string[]): CategoryImages => ({
    menu: ['https://example.com/menu.jpg'],
    novelty,
    goods: [],
    sources: { menu: 'https://example.com/menu' },
    all: ['https://example.com/menu.jpg'],
    mentionsRedrawnIllustration: false,
    redrawnPages: [],
    pages: [],
    venueNoveltyImages: [{ url: TOKYO, images: ['https://example.com/tokuten.jpg'] }],
  });
  const pages = [facts(TOKYO, 'venue', ['ホログラムステッカー'])];

  it('ノベルティの画像が無ければ、選んだ画像と取得元を入れ、all にも足す', () => {
    const { categoryImages, picked } = withNoveltyImagesFromVenues(base([]), pages);

    expect(picked?.url).toBe(TOKYO);
    expect(categoryImages.novelty).toEqual(['https://example.com/tokuten.jpg']);
    expect(categoryImages.sources).toEqual({ menu: 'https://example.com/menu', novelty: TOKYO });
    expect(categoryImages.all).toEqual(['https://example.com/menu.jpg', 'https://example.com/tokuten.jpg']);
  });

  it('ノベルティの画像が既にある (ノベルティの下層ページがある) ときは変えない', () => {
    const original = base(['https://example.com/novelty-page.jpg']);
    const { categoryImages, picked } = withNoveltyImagesFromVenues(original, pages);

    expect(picked).toBeNull();
    expect(categoryImages).toBe(original);
  });
});
