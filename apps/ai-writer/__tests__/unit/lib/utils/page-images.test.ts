import { describe, expect, it } from '@jest/globals';

import { pageImageUrls } from '@/lib/utils/page-images';

describe('pageImageUrls', () => {
  const page = 'https://shop.test/event/cafe/a.html';

  it('ページの上から順に、相対 URL を解決して返す (ヘッダーの中も含める)', () => {
    const html = `<header id="header"><img class="pc" src="img/main.webp"></header>
      <div><img src="img/drink.jpg"></div>`;

    expect(pageImageUrls(html, page, 5)).toEqual([
      'https://shop.test/event/cafe/img/main.webp',
      'https://shop.test/event/cafe/img/drink.jpg',
    ]);
  });

  it('ナビ・フッターの中、data: だけの画像、重複は除き、上限で打ち切る', () => {
    const html = `<nav><img src="/img/nav.png"></nav><img src="data:image/gif;base64,AAAA">
      <img src="img/a.jpg"><img src="img/a.jpg"><img src="img/b.jpg"><img src="img/c.jpg">
      <footer><img src="/img/foot.png"></footer>`;

    expect(pageImageUrls(html, page, 2)).toEqual(['https://shop.test/event/cafe/img/a.jpg', 'https://shop.test/event/cafe/img/b.jpg']);
  });
});
