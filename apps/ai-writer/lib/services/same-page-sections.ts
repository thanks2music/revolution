/**
 * 公式ページの中の、メニュー・ノベルティ・グッズの節を見つける (2026-11-23)
 *
 * 1 ページ構成の公式サイト (`<section id="goods">` のように節で分けたページ) には下層ページが無く、
 * 下層ページだけから画像を拾うと 0 枚になっていた。下層ページから画像を取れなかったカテゴリは、
 * ここで見つけた節の画像を使う (`CategoryImageExtractorService`)。
 *
 * 節とみなすのは section / article / div で、次のどれかに当たるもの (ヘッダー・ナビ・フッターの中は除く)。
 * 語は Templates の `store-url-patterns.yaml` の `image_extraction.same_page_sections`。
 * - id か class の 1 語が `attribute_keywords` と一致する (部分一致はしない。`gnav-menu` に当てない)
 * - data-section-name か、節の最初の見出し (h2 / h3) の文字が `heading_keywords` と一致する
 *   (部分一致はしない。「グッズ販売における注意事項」に当てない)
 * 当たった要素が別の当たった要素を含むときは、内側を使う (ページ全体を包む div の最初の見出しが
 * 「メニュー」でも、包む div をメニューの節にしない)。
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

  const elements = $('section, article, div').toArray();
  const matches: Array<{ category: CategoryType; element: (typeof elements)[number] }> = [];
  for (const element of elements) {
    if ($(element).closest('header, nav, footer').length > 0) continue;
    const ids = normalize($(element).attr('id') ?? '').split(' ');
    const classes = normalize($(element).attr('class') ?? '').split(' ');
    const sectionName = normalize($(element).attr('data-section-name') ?? '');
    const heading = normalize($(element).find('h2, h3').first().text());

    for (const category of CATEGORIES) {
      const attributeKeywords = keywordsOf(config[category]?.attribute_keywords);
      const headingKeywords = keywordsOf(config[category]?.heading_keywords);
      const byAttribute = [...ids, ...classes].some((token) => token !== '' && attributeKeywords.includes(token));
      const byHeading = [sectionName, heading].some((text) => text !== '' && headingKeywords.includes(text));
      if (byAttribute || byHeading) {
        matches.push({ category, element });
        break;
      }
    }
  }

  // 別の当たった要素を含む要素は使わない (内側の節を使う)
  const innermost = matches.filter(
    ({ element }) => !matches.some((other) => other.element !== element && cheerio.contains(element, other.element))
  );

  const result: Partial<Record<CategoryType, string>> = {};
  for (const { category, element } of innermost) {
    result[category] = (result[category] ?? '') + $.html(element);
  }
  return result;
}
