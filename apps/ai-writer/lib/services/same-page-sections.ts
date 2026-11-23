/**
 * 公式ページの中の、メニュー・ノベルティ・グッズの節を見つける (2026-11-23)
 *
 * 1 ページ構成の公式サイト (`<section id="goods">` のように節で分けたページ) には下層ページが無く、
 * 下層ページだけから画像を拾うと 0 枚になっていた。下層ページから画像を取れなかったカテゴリは、
 * ここで見つけた節の画像を使う (`CategoryImageExtractorService`)。
 *
 * 節とみなすのは section / article / div で、自分の見出し (h2 / h3) か data-section-name を持ち、次のどちらかに当たるもの
 * (ヘッダー・ナビ・フッターの中は除く)。語は Templates の `store-url-patterns.yaml` の `image_extraction.same_page_sections`。
 * - 属性: id か class の 1 語が `attribute_keywords` と一致する (部分一致はしない。`gnav-menu` に当てない)。
 *   見出しも data-section-name も持たない要素 (ナビの `<div id="menu">` など) には当てない
 * - 見出し: data-section-name か、自分の見出しの文字が `heading_keywords` と一致する (部分一致はしない。
 *   「グッズ販売における注意事項」に当てない)。見出しの中の文字の塊 (`<h2>GOODS<span>グッズ</span></h2>` の
 *   「GOODS」「グッズ」) ごとにも比べる。自分の見出しは、要素の中の最初の見出しのうち、間に別の section / article を
 *   挟まないもの (ページ全体を包む div が、中の節の見出しで当たらないように)。同じ階層の見出しを 2 つ以上持つ要素
 *   (見出しと画像が平らに並ぶ要素) は見出しでは当てない
 * 属性の当たりを見出しの当たりより優先する (`<section id="goods"><h3>特典</h3>` はグッズ)。
 * 見出しだけで当たった要素が別のカテゴリの節を含むときは、その要素を使わない (包む要素)。属性で当たった要素が
 * 別のカテゴリの節を含むときは、その節を除いた中身を使う (グッズの節の中の購入特典の小節)。
 * 同じカテゴリの入れ子は外側にまとめる。
 */

import * as cheerio from 'cheerio';
import type { CategoryType, SamePageSectionsConfig } from '@/lib/types/subpage-detection';

const CATEGORIES: readonly CategoryType[] = ['menu', 'novelty', 'goods'];

/** 大文字・小文字と前後・連続する空白を揃える */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function keywordsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(normalize) : [];
}

/**
 * カテゴリごとに、ページの中の節の HTML (当たった節を順につないだもの) を返す。当たる節が無いカテゴリは含めない
 */
export function findSamePageSections(
  html: string,
  config: SamePageSectionsConfig | undefined
): Partial<Record<CategoryType, string>> {
  if (!config) return {};
  const $ = cheerio.load(html);
  const keywords = CATEGORIES.map((category) => ({
    category,
    attribute: keywordsOf(config[category]?.attribute_keywords),
    heading: keywordsOf(config[category]?.heading_keywords),
  }));

  const elements = $('section, article, div').toArray();
  type Element = (typeof elements)[number];
  const matches: Array<{ category: CategoryType; element: Element; byAttribute: boolean }> = [];
  for (const element of elements) {
    const $element = $(element);
    if ($element.closest('header, nav, footer').length > 0) continue;
    const firstHeading = $element.find('h2, h3').first();
    // 自分の見出し: 間に別の section / article を挟まない (挟むなら、それは中の節の見出し)
    const ownHeading =
      firstHeading.length > 0 &&
      firstHeading.parentsUntil(element).filter('section, article').length === 0;
    const sectionName = normalize($element.attr('data-section-name') ?? '');
    if (!ownHeading && sectionName === '') continue;

    const tokens = [
      ...normalize($element.attr('id') ?? '').split(' '),
      ...normalize($element.attr('class') ?? '').split(' '),
    ].filter(Boolean);
    const byAttribute = keywords.find((k) => tokens.some((token) => k.attribute.includes(token)));

    const headingTag = firstHeading.prop('tagName')?.toLowerCase() ?? 'h2';
    const singleHeading = ownHeading && $element.find(headingTag).length === 1;
    // 見出し全体と、見出しの中の文字の塊 (テキストノード) ごとに比べる
    const headingTexts = singleHeading
      ? [
          normalize(firstHeading.text()),
          ...firstHeading
            .find('*')
            .addBack()
            .contents()
            .toArray()
            .filter((node) => node.type === 'text')
            .map((node) => normalize($(node).text())),
        ].filter(Boolean)
      : [];
    const byHeading = keywords.find(
      (k) => (sectionName !== '' && k.heading.includes(sectionName)) || headingTexts.some((text) => k.heading.includes(text))
    );

    const category = (byAttribute ?? byHeading)?.category;
    if (category) matches.push({ category, element, byAttribute: byAttribute !== undefined });
  }

  const containsOtherCategory = (outer: (typeof matches)[number]) =>
    matches.filter((other) => other.category !== outer.category && cheerio.contains(outer.element, other.element));
  // 見出しだけで当たり、別のカテゴリの節を含む要素 (包む要素) は使わない
  const notWrappers = matches.filter((match) => match.byAttribute || containsOtherCategory(match).length === 0);
  // 同じカテゴリの入れ子は、外側にまとめる
  const outermost = notWrappers.filter(
    ({ category, element }) =>
      !notWrappers.some((other) => other.category === category && cheerio.contains(other.element, element))
  );

  const result: Partial<Record<CategoryType, string>> = {};
  for (const match of outermost) {
    // 中にある別のカテゴリの節は除く (それぞれのカテゴリで拾う)
    const inner = containsOtherCategory(match).map((other) => other.element);
    const sectionHtml =
      inner.length === 0
        ? $.html(match.element)
        : (() => {
            const clone = $(match.element).clone();
            const originals = $(match.element).find('*').toArray();
            const copies = clone.find('*').toArray();
            inner.forEach((element) => {
              const index = originals.indexOf(element);
              if (index !== -1) $(copies[index]).remove();
            });
            return $.html(clone);
          })();
    result[match.category] = (result[match.category] ?? '') + sectionHtml;
  }
  return result;
}
