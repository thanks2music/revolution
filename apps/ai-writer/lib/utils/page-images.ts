/**
 * 公式ページの画像の URL を、ページの上から順に返す (アイキャッチの候補。2026-11-24)
 *
 * og:image / twitter:image が壊れているページ (過去のページで `content="img/"` の実例) では、本文の画像から
 * アイキャッチを選ぶと、どの節にも属さないメインビジュアルが候補に入らず、メニュー表が選ばれた。
 * メインビジュアルはページの先頭にあるので、ページの上から順に候補にする。ナビ・フッターの中は除く
 * (ヘッダーは除かない。メインビジュアルを `<header>` に置くページがあるため)。寸法の条件は使う側が確かめる
 */
import * as cheerio from 'cheerio';

import { imageSource } from './image-source';

/**
 * @param html 公式ページの圧縮前の HTML
 * @param pageUrl 相対 URL を解決するページの URL
 * @param limit 返す数の上限
 */
export function pageImageUrls(html: string, pageUrl: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  for (const element of $('img').toArray()) {
    if (urls.length >= limit) break;
    if ($(element).closest('nav, footer').length > 0) continue;
    const src = imageSource($(element));
    if (!src) continue;
    let url: string;
    try {
      url = new URL(src, pageUrl).toString();
    } catch {
      continue;
    }
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
