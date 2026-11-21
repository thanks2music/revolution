import { buildXShareUrl } from '@/lib/reviews/share';

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
