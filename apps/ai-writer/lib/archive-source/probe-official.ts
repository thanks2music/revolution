/**
 * Decides whether an event's official site can still be the article's source.
 *
 * The site is treated as gone when it cannot be fetched (DNS, TLS, HTTP error, timeout), or when the
 * page no longer names the work (the URL was reused for another event). A 403 counts as gone too:
 * the pipeline reads the site with the same fetch, so it could not build the article from it either.
 *
 * @module lib/archive-source/probe-official
 */
import type { ContentHtmlResult } from '@/lib/utils/html-extractor';

export type OfficialSiteProbe =
  | { status: 'alive' }
  | { status: 'gone'; reason: OfficialSiteGoneReason; detail: string };

/** `http-<status>` for HTTP errors */
export type OfficialSiteGoneReason = 'unreachable' | 'timeout' | 'title-mismatch' | `http-${number}`;

export type FetchContent = (url: string) => Promise<ContentHtmlResult>;

export async function probeOfficialSite(
  officialUrl: string,
  workTitle: string,
  fetchContent: FetchContent,
): Promise<OfficialSiteProbe> {
  let page: ContentHtmlResult | undefined;
  let failure: { reason: OfficialSiteGoneReason; detail: string } | undefined;
  // A timeout, 429 or 5xx can be passing, so one more try before calling the site gone
  for (let attempt = 1; attempt <= 2 && !page; attempt++) {
    try {
      page = await fetchContent(officialUrl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failure = { reason: classifyFetchError(detail), detail };
      if (!isTransient(failure.reason)) break;
    }
  }
  if (!page) return { status: 'gone', reason: failure?.reason ?? 'unreachable', detail: failure?.detail ?? '' };
  if (!pageNamesWork(page.raw, workTitle)) {
    return { status: 'gone', reason: 'title-mismatch', detail: `the page does not contain "${workTitle}"` };
  }
  return { status: 'alive' };
}

function isTransient(reason: OfficialSiteGoneReason): boolean {
  if (reason === 'timeout') return true;
  const status = reason.startsWith('http-') ? Number(reason.slice(5)) : 0;
  return status === 429 || status >= 500;
}

/** Whether the reason means the whole site cannot be reached (its domain may be closed), not just one page */
export function siteUnreachable(reason: string): boolean {
  return reason === 'unreachable' || reason === 'timeout';
}

/** Maps the error messages of `extractContentHtml` to a reason */
export function classifyFetchError(message: string): OfficialSiteGoneReason {
  const http = message.match(/HTTP error! status: (\d{3})/);
  if (http) return `http-${Number(http[1])}`;
  if (/タイムアウト|timed? ?out|AbortError/i.test(message)) return 'timeout';
  return 'unreachable';
}

/**
 * Whether the page text contains the work title, ignoring width, case, spaces and punctuation
 * (official sites write 「」, full-width marks and spaces differently from the archive).
 * Image `alt` / `title` texts and `og:title` count too: many official sites show the title only as
 * a logo image. An empty title cannot be checked and counts as named.
 */
export function pageNamesWork(pageHtml: string, workTitle: string): boolean {
  const title = normalizeForMatch(workTitle);
  if (title.length === 0) return true;
  return normalizeForMatch(pageText(pageHtml)).includes(title);
}

/** The page's visible text plus the attribute texts that name things (`alt`, `title`, `og:title`) */
function pageText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const attributes = [...body.matchAll(/\s(?:alt|title)\s*=\s*"([^"]*)"/gi)].map((match) => match[1]);
  const ogTitle = [...body.matchAll(/<meta\b[^>]*\bproperty\s*=\s*"og:title"[^>]*>/gi)].map(
    (match) => /\bcontent\s*=\s*"([^"]*)"/i.exec(match[0])?.[1] ?? '',
  );
  return [body.replace(/<[^>]+>/g, ' '), ...attributes, ...ogTitle].join(' ');
}

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
