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
  const usable = (href: string | undefined): string | null => {
    const url = toAbsoluteHttpUrl(href, articleUrl);
    return url && !isExcluded(url, rules) ? url : null;
  };

  // Table rows: labels in order of preference, then rows in document order
  const rows = $('tr')
    .toArray()
    .map((row) => ({ label: $(row).find('th').first().text().trim(), links: $(row).find('td a[href]').toArray() }));
  for (const label of rules.table_row_labels) {
    for (const row of rows) {
      if (row.label !== label) continue;
      for (const link of row.links) {
        const url = usable($(link).attr('href'));
        if (url) return url;
      }
    }
  }

  if (rules.fallback_selector) {
    for (const link of $(rules.fallback_selector).toArray()) {
      const url = usable($(link).attr('href'));
      if (url) return url;
    }
  }
  return null;
}

function toAbsoluteHttpUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isExcluded(url: string, rules: OfficialUrlRules): boolean {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const excludedHost = rules.exclude_hosts.some((suffix) => {
    const s = suffix.toLowerCase();
    return host === s || host.endsWith(`.${s}`);
  });
  if (excludedHost) return true;
  return rules.exclude_query_params.some((param) => parsed.searchParams.has(param));
}
