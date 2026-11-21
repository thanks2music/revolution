import {
  REVIEW_ATTENDANCES,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
} from '@revolution/schemas/review';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  buildXShareUrl,
} from '@/lib/reviews/labels';

describe('口コミの画面の言葉', () => {
  it('値の一覧と同じ順・同じ数の言葉がある (DB の値を足したら、ここも足す)', () => {
    expect(Object.keys(ATTENDANCE_LABELS)).toEqual([...REVIEW_ATTENDANCES]);
    expect(Object.keys(FOOD_COST_BAND_LABELS)).toEqual([...REVIEW_FOOD_COST_BANDS]);
    expect(Object.keys(GOODS_COST_BAND_LABELS)).toEqual([...REVIEW_GOODS_COST_BANDS]);
  });
});

describe('buildXShareUrl', () => {
  it('開催名・会場名・サイト名と、開催のページの URL を共有の文にする', () => {
    const url = new URL(
      buildXShareUrl({
        eventName: '作品 × カフェ',
        venueName: '渋谷会場',
        siteName: 'サイト',
        pageUrl: 'https://example.com/collabo-cafe/12/shibuya',
      })
    );

    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe(
      '作品 × カフェ 渋谷会場 の口コミを書きました｜サイト'
    );
    expect(url.searchParams.get('url')).toBe('https://example.com/collabo-cafe/12/shibuya');
  });
});
