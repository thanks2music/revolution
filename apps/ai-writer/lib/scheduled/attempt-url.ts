/**
 * The key a scheduled run uses to tell whether a URL was already tried.
 *
 * The same page can arrive under different URLs: a Google Alerts redirect, or the same link
 * with tracking parameters added. Comparing raw URLs would try such a page twice and pay for
 * the AI calls again. The rules (decided 2026-11-15):
 *
 * - unwrap a Google redirect URL to the page it points to
 * - drop tracking parameters (`utm_*` and the click IDs below) and the `#fragment`
 * - keep everything else as it is: the trailing `/`, other query parameters, the scheme and
 *   `www`. Some sites serve a different page when those change, so treating them as the same
 *   page could skip a page that was never tried
 *
 * @module lib/scheduled/attempt-url
 */
import { createHash } from 'node:crypto';

import { extractActualUrl } from '@/lib/utils/html-extractor';
import { stripUtmFromUrl } from '@/lib/utils/url';

/** Click IDs: query parameters that only track the visit (`utm_*` is removed by `stripUtmFromUrl`) */
const CLICK_ID_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'msclkid', 'mc_cid', 'mc_eid']);

/**
 * The URL used for comparison and stored in the attempt record.
 * A string that is not a URL is returned trimmed but otherwise unchanged.
 */
export function normalizeAttemptUrl(rawUrl: string): string {
  const unwrapped = stripUtmFromUrl(extractActualUrl(rawUrl.trim()));
  let url: URL;
  try {
    url = new URL(unwrapped);
  } catch {
    return unwrapped;
  }

  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (CLICK_ID_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
  }
  // `URL` keeps a lone `?` when every parameter was removed; drop it
  if (url.searchParams.size === 0) url.search = '';
  return url.toString();
}

/**
 * The Firestore document ID for a normalized URL.
 * A URL cannot be a document ID as it is (`/` is not allowed), so the SHA-256 of it is used.
 */
export function attemptDocId(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}
