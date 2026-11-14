/**
 * Keeps an article built without its official site (the site is gone) from linking to that site:
 * a closed domain can later be taken over by someone else.
 *
 * @module lib/utils/without-official-urls
 */

/** The extraction result with its official site URLs removed (`公式サイトURL` and each occurrence's `official_url`) */
export function withoutOfficialUrls<T extends { 公式サイトURL: string; event_data?: unknown }>(extraction: T): T {
  return { ...extraction, 公式サイトURL: '', event_data: withoutOccurrenceUrls(extraction.event_data) };
}

function withoutOccurrenceUrls(eventData: unknown): unknown {
  if (!eventData || typeof eventData !== 'object') return eventData;
  const occurrences = (eventData as { occurrences?: unknown }).occurrences;
  if (!Array.isArray(occurrences)) return eventData;
  return {
    ...eventData,
    occurrences: occurrences.map((occurrence) =>
      occurrence && typeof occurrence === 'object' ? { ...occurrence, official_url: null } : occurrence,
    ),
  };
}

/** Placeholders and empty links the article text leaves where the official site URL would go */
const EMPTY_LINK_MARKERS = ['{{公式サイトURL}}', ']()'];
const URL_PATTERN = /https?:\/\/[^\s)\]>"'|]+/gi;

/**
 * Removes the lines that point readers to the closed site: any line with a URL on the same host
 * (ignoring case and a leading `www.`, so other pages and other spellings of the URL are caught too)
 * or with an empty official-site link. The article text writes such a pointer as one table row or
 * one sentence. Returns the removed lines so the caller can log them.
 */
export function removeLinksToClosedSite(
  markdown: string,
  closedSiteUrl: string,
): { content: string; removed: string[] } {
  const closedHost = hostKey(closedSiteUrl);
  const removed: string[] = [];
  const kept = markdown.split('\n').filter((line) => {
    const linksToClosedSite =
      EMPTY_LINK_MARKERS.some((marker) => line.includes(marker)) ||
      (closedHost !== null && (line.match(URL_PATTERN) ?? []).some((url) => hostKey(url) === closedHost));
    if (linksToClosedSite) removed.push(line);
    return !linksToClosedSite;
  });
  return { content: kept.join('\n'), removed };
}

function hostKey(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
