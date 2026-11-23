/**
 * 公式ページの中の、メニュー・ノベルティ・グッズの節を見つける (2026-11-23)
 *
 * 1 ページ構成の公式サイト (`<section id="goods">` のように節で分けたページ) には下層ページが無く、
 * 下層ページだけから画像を拾うと 0 枚になっていた。下層ページから画像を取れなかったカテゴリは、
 * ここで見つけた節の画像を使う (`CategoryImageExtractorService`)。
 *
 * 節とみなすのは section / article / div で、見出し (h2 / h3) か data-section-name を持ち、次のどちらかに当たるもの
 * (ヘッダー・ナビ・フッターの中は除く)。語は Templates の `store-url-patterns.yaml` の `image_extraction.same_page_sections`。
 * - 属性: id か class の 1 語が `attribute_keywords` と一致する (部分一致はしない。`gnav-menu` に当てない)。
 *   見出しを持たない要素 (ナビの `<div id="menu">` など) には当てない
 * - 見出し: data-section-name か、最初の見出しの文字が `heading_keywords` と一致する (部分一致はしない。
 *   「グッズ販売における注意事項」に当てない)。最初の見出しと同じ階層の見出しを 2 つ以上持つ要素
 *   (見出しと画像が平らに並ぶページ全体) は、最初の見出しだけで 1 つの節にしない
 * 属性の当たりを見出しの当たりより優先する (`<section id="goods"><h3>特典</h3>` はグッズ)。
 * 当たった要素が別のカテゴリの節を含むときは使わない (ページ全体を包む要素)。同じカテゴリの節の中の
 * 当たり (見出しだけを包む div など) は、外側の節にまとめる。
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
  const matches: Array<{ category: CategoryType; element: (typeof elements)[number] }> = [];
  for (const element of elements) {
    const $element = $(element);
    if ($element.closest('header, nav, footer').length > 0) continue;
    const firstHeading = $element.find('h2, h3').first();
    const sectionName = normalize($element.attr('data-section-name') ?? '');
    // 見出しも data-section-name も無い要素は節にしない (ナビの <div id="menu"> など)
    if (firstHeading.length === 0 && sectionName === '') continue;

    const tokens = [
      ...normalize($element.attr('id') ?? '').split(' '),
      ...normalize($element.attr('class') ?? '').split(' '),
    ].filter(Boolean);
    const byAttribute = keywords.find((k) => tokens.some((token) => k.attribute.includes(token)));

    const headingText = normalize(firstHeading.text());
    const singleHeading = $element.find(firstHeading.prop('tagName')?.toLowerCase() ?? 'h2').length === 1;
    const byHeading = keywords.find(
      (k) =>
        (sectionName !== '' && k.heading.includes(sectionName)) ||
        (singleHeading && headingText !== '' && k.heading.includes(headingText))
    );

    const category = (byAttribute ?? byHeading)?.category;
    if (category) matches.push({ category, element });
  }

  // 別のカテゴリの節を含む要素 (ページ全体を包む要素) は使わない
  const notWrappers = matches.filter(
    ({ category, element }) =>
      !matches.some((other) => other.category !== category && cheerio.contains(element, other.element))
  );
  // 同じカテゴリの節の中の当たりは、外側にまとめる
  const outermost = notWrappers.filter(
    ({ category, element }) =>
      !notWrappers.some((other) => other.category === category && cheerio.contains(other.element, element))
  );

  const result: Partial<Record<CategoryType, string>> = {};
  for (const { category, element } of outermost) {
    result[category] = (result[category] ?? '') + $.html(element);
  }
  return result;
}
