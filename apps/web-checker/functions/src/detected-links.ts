import * as cheerio from 'cheerio';

import { normalizeAttemptUrl } from '@revolution/net/attempt-url';

/**
 * 1 回の更新検知で AI ライターに渡すリンクの上限。サイトの作り変えなどで、お知らせ欄のリンクが一度に
 * 入れ替わった時に、定期実行の候補が埋まらないようにする
 */
export const MAX_LINKS_PER_DETECTION = 20;

/** 抜き出した HTML にあるリンクを、正規化した URL の集合にする (http(s) だけ。相対は監視対象の URL を基準に直す) */
function linksIn(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')?.trim();
    if (!href) return;
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') return;
    links.push(normalizeAttemptUrl(absolute.href));
  });
  return links;
}

/**
 * 更新検知で新しく現れたリンク (今回の HTML にあり、前回の HTML に無い物)。現れた順で、重複と
 * 監視対象のページそのものを除き、{@link MAX_LINKS_PER_DETECTION} 件まで。
 *
 * 行の差分 (テキスト) からはリンクを取れないので、前回と今回の HTML のリンクを比べる。
 */
export function newLinks(previousHtml: string, currentHtml: string, pageUrl: string): string[] {
  const before = new Set(linksIn(previousHtml, pageUrl));
  const page = normalizeAttemptUrl(pageUrl);
  const result: string[] = [];
  for (const link of linksIn(currentHtml, pageUrl)) {
    if (before.has(link) || link === page || result.includes(link)) continue;
    result.push(link);
    if (result.length === MAX_LINKS_PER_DETECTION) break;
  }
  return result;
}
