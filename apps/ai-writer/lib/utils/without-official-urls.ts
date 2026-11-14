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

/**
 * Removes the lines that contain any of the strings: the summary table row and the sentence that
 * point readers to the official site (the article text writes them as one line each)
 */
export function removeLinesContaining(markdown: string, needles: readonly string[]): string {
  const targets = needles.filter((needle) => needle.length > 0);
  if (targets.length === 0) return markdown;
  return markdown
    .split('\n')
    .filter((line) => !targets.some((needle) => line.includes(needle)))
    .join('\n');
}
