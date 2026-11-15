/**
 * Reads one archive article through the archive's WordPress REST API.
 *
 * @module lib/archive-source/resolve-article
 */
import * as cheerio from 'cheerio';

import { BROWSER_USER_AGENT, FETCH_TIMEOUT_MS } from '@/lib/utils/http-constants';

import type { ArchiveSource } from './config';
import { pickOfficialUrl } from './official-url';

export interface ArchiveArticle {
  /** The archive's own URL of the article (the input URL may differ, e.g. with or without `www.`) */
  articleUrl: string;
  /** Title with HTML entities decoded */
  title: string;
  /** Article body HTML (`content.rendered`) */
  contentHtml: string;
  /** Event start date (YYYY-MM-DD, JST), or null when the API has none */
  startsOn: string | null;
  endsOn: string | null;
  /** Year of the start date: the article's `year` (canonical key, image folder). Null when unknown */
  eventYear: number | null;
  /** Event type slug from the article's categories, or null when none is configured */
  eventType: string | null;
  featuredImageUrl: string | null;
  officialUrl: string | null;
}

/** Minimal shape of the REST response this module reads (plus the fields named in `source.fields`) */
interface RestPost {
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> };
  [field: string]: unknown;
}

export type FetchJson = (url: string) => Promise<unknown>;

/** The last non-empty path segment of the article URL, used as the REST `slug` */
export function slugFromArticleUrl(articleUrl: string): string | null {
  const segments = new URL(articleUrl).pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** "YYYY-MM-DD" from a date-time with a space or `T` (`2000-01-02 03:04:05`, `2000-01-02T03:04:05+09:00`) */
export function parseArchiveDate(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export async function resolveArchiveArticle(
  articleUrl: string,
  source: ArchiveSource,
  fetchJson: FetchJson = fetchJsonWithTimeout,
): Promise<ArchiveArticle> {
  const slug = slugFromArticleUrl(articleUrl);
  if (!slug) throw new Error(`Archive article URL has no slug: ${articleUrl}`);

  const apiUrl = new URL(source.api_base);
  apiUrl.searchParams.set('slug', slug);
  apiUrl.searchParams.set('_embed', 'wp:featuredmedia');
  // Only the fields read here (`_links` and `_embedded` are needed for the embed to work)
  apiUrl.searchParams.set(
    '_fields',
    ['link', 'title', 'content', '_links', '_embedded', source.fields.categories, source.fields.start, source.fields.end].join(','),
  );
  const body = await fetchJson(apiUrl.toString());
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error(`Archive article not found by slug "${slug}"`);
  }
  const post = pickPost(body as RestPost[], articleUrl, slug);
  const contentHtml = post.content?.rendered ?? '';
  const startsOn = parseArchiveDate(stringField(post, source.fields.start));
  const canonicalUrl = post.link ?? articleUrl;

  return {
    articleUrl: canonicalUrl,
    title: decodeEntities(post.title?.rendered ?? ''),
    contentHtml,
    startsOn,
    endsOn: parseArchiveDate(stringField(post, source.fields.end)),
    eventYear: startsOn ? Number(startsOn.slice(0, 4)) : null,
    eventType: eventTypeOf(numberListField(post, source.fields.categories), source),
    featuredImageUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
    officialUrl: pickOfficialUrl(contentHtml, canonicalUrl, source.official_url),
  };
}

/**
 * The post for the article: the one whose link has the article's path. A single result is used as
 * it is; several results without a match are an error rather than a guess
 */
function pickPost(posts: RestPost[], articleUrl: string, slug: string): RestPost {
  const path = pathOf(articleUrl);
  const match = posts.find((post) => post.link !== undefined && pathOf(post.link) === path);
  if (match) return match;
  if (posts.length === 1) {
    console.warn(`⚠️ The archive article for slug "${slug}" is at ${posts[0].link ?? '(no link)'}, not ${articleUrl}`);
    return posts[0];
  }
  throw new Error(`Archive slug "${slug}" matched ${posts.length} articles, none at ${articleUrl}`);
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function stringField(post: RestPost, name: string): string | null {
  const value = post[name];
  return typeof value === 'string' ? value : null;
}

function numberListField(post: RestPost, name: string): number[] {
  const value = post[name];
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
}

function eventTypeOf(categoryIds: readonly number[], source: ArchiveSource): string | null {
  for (const id of categoryIds) {
    const slug = source.categories[String(id)];
    if (slug) return slug;
  }
  return null;
}

/** Decodes the HTML entities WordPress puts in titles (and drops any markup) */
export function decodeEntities(text: string): string {
  return cheerio.load(text, null, false).text();
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Archive API returned HTTP ${response.status}`);
  return response.json();
}
