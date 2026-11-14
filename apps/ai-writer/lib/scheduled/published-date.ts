/**
 * Read when a page was published from its HTML, without AI.
 *
 * A scheduled run uses this date to decide when to try an "unannounced" event again
 * (`retry-policy.ts`). The page's own date wins over the RSS delivery date, because a feed can
 * deliver an old page long after it was written (decided 2026-11-15). Sources, in order:
 *
 * 1. `<meta property="article:published_time">`
 * 2. JSON-LD `datePublished`
 * 3. `<time datetime>`
 * 4. an element whose class or id contains `date`, `time`, `update` or `publish`
 *    (`publish` before plain `date`/`time`, and `update` last). Names of an event's schedule
 *    (`event`, `schedule`, `period`, `timetable`, `start`, `end`) are left out unless they say `publish`
 *
 * A date in the future is ignored (it is usually an event date, not a publish date), and so is
 * anything before 2000. When nothing is found the caller falls back to the RSS delivery date or
 * the registration date.
 *
 * @module lib/scheduled/published-date
 */
import * as cheerio from 'cheerio';

import { toJstDateString } from '@/lib/utils/date';

export type PublishedDateSource = 'meta' | 'json-ld' | 'time-element' | 'date-element';

export interface PublishedDate {
  date: Date;
  source: PublishedDateSource;
}

const MIN_YEAR = 2000;
/** A date-only value is read as a day in Japan */
const JST_OFFSET = '+09:00';

/**
 * Parse the date formats seen on Japanese pages: ISO 8601, `2026-11-14`, `2026/11/14`,
 * `2026.11.14` and `2026年11月14日`, each optionally followed by `HH:mm`.
 */
export function parseDateText(text: string): Date | undefined {
  const value = text.trim();
  if (!value) return undefined;

  // ISO 8601 with a time (meta tags, JSON-LD, <time datetime>). Without an offset it is a time
  // in Japan; `new Date` would read it in the machine's zone (UTC on Cloud Run)
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const date = new Date(hasOffset ? value : `${value}${JST_OFFSET}`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const match = value.match(
    /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[^\d]{0,12}?(\d{1,2}):(\d{2}))?/,
  );
  if (!match) return undefined;
  const [, y, mo, d, h, mi] = match;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const pad = (n: string | number) => String(n).padStart(2, '0');
  const time = h !== undefined ? `${pad(h)}:${mi}:00` : '00:00:00';
  const date = new Date(`${y}-${pad(month)}-${pad(day)}T${time}${JST_OFFSET}`);
  if (Number.isNaN(date.getTime())) return undefined;
  // Rejects dates such as 2026-02-31, which `Date` would roll over into March
  return toJstDateString(date) === `${y}-${pad(month)}-${pad(day)}` ? date : undefined;
}

function usable(date: Date | undefined, now: Date): date is Date {
  return date !== undefined && date.getTime() <= now.getTime() && date.getUTCFullYear() >= MIN_YEAR;
}

/** First `datePublished` found anywhere in a JSON-LD value (arrays and `@graph` included) */
function findDatePublished(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDatePublished(item);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.datePublished === 'string') return record.datePublished;
    for (const value of Object.values(record)) {
      const found = findDatePublished(value);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Names of an event's schedule, not of the page's date ("event-date", "timetable" ...).
 * A past event date taken as the publish date would end the retries too early
 */
const SCHEDULE_NAME = /(?:^|[^a-z])(?:event|schedule|period|timetable|start|end)/;

/** Lower is preferred. `undefined` means the element is not a date element */
function dateElementRank(classAndId: string): number | undefined {
  const name = classAndId.toLowerCase();
  if (name.includes('publish')) return 0;
  if (SCHEDULE_NAME.test(name)) return undefined;
  if (name.includes('update')) return 2;
  if (name.includes('date') || name.includes('time')) return 1;
  return undefined;
}

export function extractPublishedDate(html: string, now: Date = new Date()): PublishedDate | undefined {
  const $ = cheerio.load(html);

  // 1. Open Graph article meta
  for (const element of $('meta[property="article:published_time"]').toArray()) {
    const date = parseDateText($(element).attr('content') ?? '');
    if (usable(date, now)) return { date, source: 'meta' };
  }

  // 2. JSON-LD. Broken JSON on a page is common and is skipped
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(element).text());
    } catch {
      continue;
    }
    const value = findDatePublished(parsed);
    const date = value ? parseDateText(value) : undefined;
    if (usable(date, now)) return { date, source: 'json-ld' };
  }

  // 3. <time datetime>, ranked by the element's class/id like step 4
  const timeElements = $('time[datetime]')
    .toArray()
    .map(element => ({
      rank: dateElementRank(`${$(element).attr('class') ?? ''} ${$(element).attr('id') ?? ''}`) ?? 1,
      text: $(element).attr('datetime') ?? '',
    }))
    .sort((a, b) => a.rank - b.rank);
  for (const { text } of timeElements) {
    const date = parseDateText(text);
    if (usable(date, now)) return { date, source: 'time-element' };
  }

  // 4. Elements named like a date. The text is read (a datetime/content attribute first)
  const dateElements = $('[class], [id]')
    .toArray()
    .flatMap(element => {
      const rank = dateElementRank(`${$(element).attr('class') ?? ''} ${$(element).attr('id') ?? ''}`);
      if (rank === undefined) return [];
      const $element = $(element);
      const text = $element.attr('datetime') ?? $element.attr('content') ?? $element.text();
      // A long block is a container (an article body), not a date label
      return text.length <= 200 ? [{ rank, text }] : [];
    })
    .sort((a, b) => a.rank - b.rank);
  for (const { text } of dateElements) {
    const date = parseDateText(text);
    if (usable(date, now)) return { date, source: 'date-element' };
  }

  return undefined;
}
