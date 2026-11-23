import { describe, expect, it } from '@jest/globals';

import { findSamePageSections } from '@/lib/services/same-page-sections';
import type { SamePageSectionsConfig } from '@/lib/types/subpage-detection';

/** store-url-patterns.yaml の same_page_sections の一部 */
const CONFIG: SamePageSectionsConfig = {
  menu: { attribute_keywords: ['menu', 'food'], heading_keywords: ['メニュー', 'MENU'] },
  novelty: { attribute_keywords: ['novelty', 'tokuten'], heading_keywords: ['特典', 'ノベルティ'] },
  goods: { attribute_keywords: ['goods'], heading_keywords: ['グッズ', 'GOODS'] },
};

/** 1 ページ構成のコラボカフェの公式ページの形 (節を section の id と見出しで分けたもの) */
const ONE_PAGE = `
<header id="header"><nav><div class="menu"><img src="img/nav.png"></div></nav></header>
<div id="wrapper">
  <main>
    <section id="menu" class="box"><h2>メニュー</h2><img src="img/food.webp"></section>
    <section id="goods" class="box" data-section-name="グッズ"><h2>グッズ</h2><img src="img/item/01.jpg"></section>
    <section id="novelty" class="box" data-section-name="特典"><h2>特典</h2><img src="img/camp.webp"></section>
    <section id="notice" class="box"><h3>グッズ販売における注意事項</h3><img src="img/notice.png"></section>
  </main>
</div>
<footer><div id="goods"><img src="img/footer.png"></div></footer>`;

describe('findSamePageSections', () => {
  it('id・見出しがカテゴリの語に当たる節の HTML を、カテゴリごとに返す', () => {
    const sections = findSamePageSections(ONE_PAGE, CONFIG);

    expect(sections.menu).toContain('img/food.webp');
    expect(sections.goods).toContain('img/item/01.jpg');
    expect(sections.novelty).toContain('img/camp.webp');
  });

  it('見出しは完全一致で比べる (「グッズ販売における注意事項」の節をグッズにしない)', () => {
    const sections = findSamePageSections(ONE_PAGE, CONFIG);

    expect(Object.values(sections).join('')).not.toContain('img/notice.png');
  });

  it('ヘッダー・ナビ・フッターの中の要素は節にしない', () => {
    const sections = findSamePageSections(ONE_PAGE, CONFIG);

    expect(sections.menu).not.toContain('img/nav.png');
    expect(sections.goods).not.toContain('img/footer.png');
  });

  it('ページ全体を包む要素の最初の見出しが語に当たっても、包む要素ではなく内側の節を使う', () => {
    const html = `<div class="container"><h2>メニュー</h2><img src="img/food.webp">
      <section id="goods"><h2>GOODS</h2><img src="img/goods.jpg"></section></div>`;
    const sections = findSamePageSections(html, CONFIG);

    expect(sections.goods).toContain('img/goods.jpg');
    expect(sections.menu).toBeUndefined();
  });

  it('id・class は 1 語ずつ完全一致で比べる (gnav-menu に当てない)。大文字・小文字は区別しない', () => {
    const html = `<div class="gnav-menu"><h2>x</h2><img src="img/a.png"></div><div class="Item GOODS"><h2>商品</h2><img src="img/b.png"></div>`;
    const sections = findSamePageSections(html, CONFIG);

    expect(sections.menu).toBeUndefined();
    expect(sections.goods).toContain('img/b.png');
  });

  it('data-section-name だけでも節とみなす', () => {
    const html = `<section data-section-name="ノベルティ"><img src="img/n.png"></section>`;

    expect(findSamePageSections(html, CONFIG).novelty).toContain('img/n.png');
  });

  it('同じカテゴリの節が複数あれば、つないで返す', () => {
    const html = `<section id="goods"><h2>A</h2><img src="img/a.jpg"></section><section class="goods"><h2>B</h2><img src="img/b.jpg"></section>`;
    const goods = findSamePageSections(html, CONFIG).goods ?? '';

    expect(goods).toContain('img/a.jpg');
    expect(goods).toContain('img/b.jpg');
  });

  it('見出しを包む div が同じカテゴリに当たっても、外側の節を使う (見出しの兄弟の画像を落とさない)', () => {
    const html = `<section id="goods"><div class="ttl"><h2>GOODS</h2></div><div class="list"><img src="img/g1.jpg"></div></section>`;

    expect(findSamePageSections(html, CONFIG).goods).toContain('img/g1.jpg');
  });

  it('見出しと画像が平らに並ぶ要素は、最初の見出しだけで 1 つの節にしない (全画像が 1 カテゴリに入らない)', () => {
    const html = `<div id="main"><h2>メニュー</h2><img src="img/food.jpg"><h2>グッズ</h2><img src="img/goods.jpg"></div>`;

    expect(findSamePageSections(html, CONFIG)).toEqual({});
  });

  it('見出しを持たない要素は、id が当たっても節にしない (ナビの <div id="menu">)', () => {
    const html = `<div id="menu"><ul><li><a href="#goods"><img src="img/n_goods.png"></a></li></ul></div>`;

    expect(findSamePageSections(html, CONFIG)).toEqual({});
  });

  it('属性の当たりを見出しの当たりより優先する (id が goods で見出しが「特典」ならグッズ)', () => {
    const html = `<section id="goods"><h3>特典</h3><img src="img/x.jpg"></section>`;
    const sections = findSamePageSections(html, CONFIG);

    expect(sections.goods).toContain('img/x.jpg');
    expect(sections.novelty).toBeUndefined();
  });

  it('設定が無ければ何も返さない (Templates が古い)', () => {
    expect(findSamePageSections(ONE_PAGE, undefined)).toEqual({});
  });
});
