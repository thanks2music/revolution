import * as cheerio from 'cheerio';

import { normalizeAttemptUrl } from '@revolution/net/attempt-url';

import { isHttpUrl } from './http-url';

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
    // 正規化は Google のリダイレクトを指している先に戻すので、戻した後の URL で http(s) かを確かめる
    const normalized = normalizeAttemptUrl(absolute.href);
    let target: URL;
    try {
      target = new URL(normalized);
    } catch {
      return;
    }
    if (!isHttpUrl(target)) return;
    links.push(normalized);
  });
  return links;
}

/**
 * 更新検知で新しく現れたリンク (今回の HTML にあり、前回の HTML に無い物)。現れた順で、重複と
 * 監視対象のページそのものを除き、{@link MAX_LINKS_PER_DETECTION} 件まで。
 *
 * 行の差分 (テキスト) からはリンクを取れないので、前回と今回の HTML のリンクを比べる。
 * 相対リンクは baseUrl (`fetchFragment` が返す、リダイレクト後の URL か `<base href>`) を基準に直す。
 */
export function newLinks(
  previousHtml: string,
  currentHtml: string,
  urls: { baseUrl: string; pageUrl: string },
): string[] {
  // 前回のリンク・ページ自身・もう選んだリンクは、同じ集合で除く
  const seen = new Set([
    ...linksIn(previousHtml, urls.baseUrl),
    normalizeAttemptUrl(urls.pageUrl),
    normalizeAttemptUrl(urls.baseUrl),
  ]);
  const result: string[] = [];
  for (const link of linksIn(currentHtml, urls.baseUrl)) {
    if (seen.has(link)) continue;
    seen.add(link);
    result.push(link);
    if (result.length === MAX_LINKS_PER_DETECTION) break;
  }
  return result;
}

/** AI ライターに渡した結果 (記録した検知リンクと、記録に失敗した件数) */
export interface LinkHandoff {
  /** 新しく渡したリンク (正規化した URL)。すでに記録されていた URL は含めない */
  links: string[];
  /** 記録に失敗した件数と、最初のエラーの文言 */
  failed: number;
  error?: string;
  /** 失敗した分を、次の見回りで渡し直すか (この回の履歴を保存しなかった時) */
  willRetry?: boolean;
}
