/**
 * Picks the official site URL out of an archive article.
 *
 * The summary table row is the reliable place: the link class used as a fallback is missing on old
 * articles and points at ads, shops or social accounts on newer ones.
 *
 * @module lib/archive-source/official-url
 */
import * as cheerio from 'cheerio';

import type { ArchiveSource } from './config';

type OfficialUrlRules = ArchiveSource['official_url'];

/** The official site URL, or null when the article has no usable link */
export function pickOfficialUrl(contentHtml: string, articleUrl: string, rules: OfficialUrlRules): string | null {
  const $ = cheerio.load(contentHtml, null, false);
  // Ad query params only mark ads among the fallback links: the archive tags its own table links
  // to official sites with the same params
  const usable = (href: string | undefined, checkQuery: boolean): string | null => {
    const url = toAbsoluteHttpUrl(href, articleUrl);
    if (!url || isExcludedHost(url, rules)) return null;
    return checkQuery && hasExcludedQuery(url, rules) ? null : url;
  };

  // Table rows: labels in order of preference, then rows in document order
  const rows = $('tr')
    .toArray()
    .map((row) => ({ label: $(row).find('th').first().text().trim(), links: $(row).find('td a[href]').toArray() }));
  for (const label of rules.table_row_labels) {
    for (const row of rows) {
      if (row.label !== label) continue;
      for (const link of row.links) {
        const url = usable($(link).attr('href'), false);
        if (url) return url;
      }
    }
  }

  if (rules.fallback_selector) {
    for (const link of $(rules.fallback_selector).toArray()) {
      const url = usable($(link).attr('href'), true);
      if (url) return url;
    }
  }
  return null;
}

function toAbsoluteHttpUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    repairQueryInPath(url);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Turns a tracking query written without `?` (`/utm_source=a&utm_medium=b`) back into a query, so the
 * page path is right when the site is probed and tracking params can be stripped later.
 */
function repairQueryInPath(url: URL): void {
  if (url.search) return;
  const match = /^(.*\/)(utm_[a-z]+=[^/]*)$/i.exec(url.pathname);
  if (!match) return;
  url.pathname = match[1];
  url.search = `?${match[2]}`;
}

function isExcludedHost(url: string, rules: OfficialUrlRules): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return rules.exclude_hosts.some((suffix) => {
    const s = suffix.toLowerCase();
    return host === s || host.endsWith(`.${s}`);
  });
}

function hasExcludedQuery(url: string, rules: OfficialUrlRules): boolean {
  const params = new URL(url).searchParams;
  return rules.exclude_query_params.some((param) => params.has(param));
}
