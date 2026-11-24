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
 *
 * タブで分けたページ (2026-11-24): タブ (`<label for="tab1">` か、`aria-controls` を持つ role="tab" の要素) の文字が `heading_keywords` と
 * 一致すれば、そのタブの中身 (`aria-controls` の id、または `tab1_content` のように for の値に `_content` などを付けた id の要素) を
 * 属性の当たりと同じ強さの節とみなす。CSS だけで切り替えるタブ (`#tab1:checked ~ #tab1_content`) は、ラベルと中身が id の
 * 名前でしかつながらないため
 */

import * as cheerio from 'cheerio';
import type { CategoryType, SamePageSectionsConfig } from '@/lib/types/subpage-detection';

const CATEGORIES: readonly CategoryType[] = ['menu', 'novelty', 'goods'];

/** 節から除く小節に一時的に付ける印 */
const OMIT_ATTRIBUTE = 'data-same-page-omit';

/** `<label for="X">` のタブの中身とみなす id の付け方 (X の後ろに付く語) */
const TAB_PANEL_SUFFIXES = ['_content', '-content', '_panel', '-panel'];

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
    const headingTexts = singleHeading ? textCandidates(firstHeading) : [];
    const byHeading = keywords.find(
      (k) => (sectionName !== '' && k.heading.includes(sectionName)) || headingTexts.some((text) => k.heading.includes(text))
    );

    const category = (byAttribute ?? byHeading)?.category;
    if (category) matches.push({ category, element, byAttribute: byAttribute !== undefined });
  }

  // タブ: タブの文字が見出しの語に当たれば、その中身を節にする (属性の当たりと同じ扱い)
  // id の一覧は、タブが見出しの語に当たったときだけ作る (当たらないページが大半)
  let byId: Map<string, Element> | undefined;
  const idMap = () => {
    if (!byId) {
      byId = new Map();
      for (const element of $('[id]').toArray()) {
        const id = $(element).attr('id');
        if (id && !byId.has(id)) byId.set(id, element);
      }
    }
    return byId;
  };
  // aria-controls は開閉ボタン (ハンバーガーの「MENU」など) にも付くので、タブ (role="tab" か、role="tablist" の中) だけを見る
  for (const tab of $('label[for], [role="tab"][aria-controls], [role="tablist"] [aria-controls]').toArray()) {
    if ($(tab).closest('header, nav, footer').length > 0) continue;
    const texts = textCandidates($(tab));
    const hit = keywords.find((k) => texts.some((text) => k.heading.includes(text)));
    if (!hit) continue;
    const panel = tabPanel($(tab).attr('aria-controls'), $(tab).attr('for'), idMap());
    if (!panel || $(panel).closest('header, nav, footer').length > 0) continue;
    if (matches.some((match) => match.element === panel)) continue;
    matches.push({ category: hit.category, element: panel, byAttribute: true });
  }

  // 中にある別のカテゴリの節 (1 回だけ数える)
  const withInner = matches.map((match) => ({
    ...match,
    inner: matches.filter((other) => other.category !== match.category && cheerio.contains(match.element, other.element)),
  }));
  // 見出しだけで当たり、別のカテゴリの節を含む要素 (包む要素) は使わない
  const notWrappers = withInner.filter((match) => match.byAttribute || match.inner.length === 0);
  // 同じカテゴリの入れ子は、外側にまとめる
  const outermost = notWrappers.filter(
    ({ category, element }) =>
      !notWrappers.some((other) => other.category === category && cheerio.contains(other.element, element))
  );

  const result: Partial<Record<CategoryType, string>> = {};
  for (const match of outermost) {
    // 中にある別のカテゴリの節は除く (それぞれのカテゴリで拾う)。印を付けて複製し、複製から消す
    const omitted = $(match.inner.map((other) => other.element)).attr(OMIT_ATTRIBUTE, '');
    const section = $(match.element).clone();
    omitted.removeAttr(OMIT_ATTRIBUTE);
    section.find(`[${OMIT_ATTRIBUTE}]`).remove();
    result[match.category] = (result[match.category] ?? '') + $.html(section);
  }
  return result;

  /** 要素の文字全体と、中の文字の塊 (テキストノード) ごとの文字 (`<h2>GOODS<span>グッズ</span></h2>`・`メニュー<br>▼`) */
  function textCandidates(node: cheerio.Cheerio<Element>): string[] {
    return [
      normalize(node.text()),
      ...node
        .find('*')
        .addBack()
        .contents()
        .toArray()
        .filter((child) => child.type === 'text')
        .map((child) => normalize($(child).text())),
    ].filter(Boolean);
  }
}

/** タブの中身の要素。aria-controls の id、無ければ label の for の値に TAB_PANEL_SUFFIXES を付けた id */
function tabPanel<T>(controls: string | undefined, forId: string | undefined, byId: Map<string, T>): T | undefined {
  if (controls) return controls.split(/\s+/).map((id) => byId.get(id)).find(Boolean);
  if (!forId) return undefined;
  return TAB_PANEL_SUFFIXES.map((suffix) => byId.get(`${forId}${suffix}`)).find(Boolean);
}
