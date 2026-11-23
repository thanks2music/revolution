import * as cheerio from 'cheerio';
import { diffLines } from 'diff';

/**
 * 抜き出した HTML を、比べやすいテキストにする。
 * 閉じタグと `<br>` の後で改行し、空白をつめる (要素ごとに 1 行になる)。
 */
export function toComparableText(html: string): string {
  const withBreaks = html.replace(/<\/(.*?)>/g, '</$1>\n').replace(/<br\s*\/?>/g, '<br>\n');
  return cheerio
    .load(withBreaks)
    .text()
    .replace(/[\t \u3000]+/g, ' ')
    .replace(/\s+\n/g, '\n');
}

/**
 * 行の差分を Slack の mrkdwn で表す。追加は `+ `、削除は `- ` + 取り消し線。
 */
export function formatLineDiff(oldText: string, newText: string): string {
  let result = '';
  for (const change of diffLines(oldText, newText)) {
    if (/^\n+$/.test(change.value)) continue;
    if (change.added) {
      result += `+ ${change.value.trim().replace(/\n/g, '\n  ')}\n`;
    } else if (change.removed) {
      result += `- ~${change.value.trim().replace(/\s*\n/g, '~\n  ~')}~\n`;
    }
  }
  return result;
}
