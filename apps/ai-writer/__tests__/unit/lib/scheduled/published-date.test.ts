/**
 * Layer 1: reading the publish date from a page (the order decided 2026-11-15).
 */
import { describe, expect, it } from '@jest/globals';

import { extractPublishedDate, parseDateText } from '@/lib/scheduled/published-date';

const NOW = new Date('2026-11-15T03:00:00Z'); // 12:00 in Japan

const page = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('parseDateText', () => {
  it.each([
    ['2026-11-14T10:00:00+09:00', '2026-11-14T01:00:00.000Z'],
    ['2026-11-14', '2026-11-13T15:00:00.000Z'],
    ['2026/11/14 18:30', '2026-11-14T09:30:00.000Z'],
    ['2026.11.4', '2026-11-03T15:00:00.000Z'],
    ['公開日：2026年11月14日', '2026-11-13T15:00:00.000Z'],
    ['2026年11月14日(金) 10:05', '2026-11-14T01:05:00.000Z'],
    ['2026-11-14T10:00:00', '2026-11-14T01:00:00.000Z'],
    ['2026-11-14T10:00:00Z', '2026-11-14T10:00:00.000Z'],
  ])('reads %s', (text, iso) => {
    expect(parseDateText(text)?.toISOString()).toBe(iso);
  });

  it.each(['', '更新', '2026-13-01', '2026年2月31日'])('rejects %p', text => {
    expect(parseDateText(text)).toBeUndefined();
  });
});

describe('extractPublishedDate', () => {
  it('prefers the article:published_time meta over everything else', () => {
    const html = page(
      '<meta property="article:published_time" content="2026-11-10T09:00:00+09:00">' +
        '<script type="application/ld+json">{"datePublished":"2026-11-01"}</script>',
      '<time datetime="2026-11-02">x</time>',
    );
    expect(extractPublishedDate(html, NOW)).toEqual({
      date: new Date('2026-11-10T00:00:00Z'),
      source: 'meta',
    });
  });

  it('reads JSON-LD datePublished, also inside @graph, and skips broken JSON', () => {
    const html = page(
      '<script type="application/ld+json">{broken</script>' +
        '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","datePublished":"2026-11-09T12:00:00+09:00"}]}</script>',
    );
    expect(extractPublishedDate(html, NOW)?.source).toBe('json-ld');
    expect(extractPublishedDate(html, NOW)?.date.toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });

  it('reads <time datetime>, preferring a publish one over an update one', () => {
    const html = page('', '<time class="updated" datetime="2026-11-12">u</time><time class="published" datetime="2026-11-08">p</time>');
    expect(extractPublishedDate(html, NOW)).toEqual({ date: new Date('2026-11-07T15:00:00Z'), source: 'time-element' });
  });

  it('reads an element named like a date, publish before plain date before update', () => {
    const html = page(
      '',
      '<span class="update-date">2026.11.13</span><p id="post-date">2026.11.11</p><div class="publish">2026年11月6日</div>',
    );
    expect(extractPublishedDate(html, NOW)).toEqual({ date: new Date('2026-11-05T15:00:00Z'), source: 'date-element' });
  });

  it('ignores dates in the future (an event date is not a publish date)', () => {
    const html = page(
      '<meta property="article:published_time" content="2026-12-01T00:00:00+09:00">',
      '<span class="date">2026/11/03</span>',
    );
    expect(extractPublishedDate(html, NOW)).toEqual({ date: new Date('2026-11-02T15:00:00Z'), source: 'date-element' });
  });

  it('leaves out the event schedule ("event-date", "timetable", "start-date") but not "publish"', () => {
    const html = page(
      '',
      '<span class="event-date">2026年9月1日〜</span><p class="timetable">2026/10/1 10:00</p>' +
        '<p id="start-date">2026.10.2</p><span class="calendar-date">2026.11.12</span>',
    );
    expect(extractPublishedDate(html, NOW)).toEqual({ date: new Date('2026-11-11T15:00:00Z'), source: 'date-element' });
  });

  it('ignores long blocks whose class happens to contain "date"', () => {
    const html = page('', `<div class="update-area">${'本文 '.repeat(100)}2026年11月1日</div>`);
    expect(extractPublishedDate(html, NOW)).toBeUndefined();
  });

  it('returns undefined when the page shows no date', () => {
    expect(extractPublishedDate(page('<title>t</title>', '<p>本文</p>'), NOW)).toBeUndefined();
  });
});
