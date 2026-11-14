import { describe, expect, it } from '@jest/globals';

import { pickOfficialUrl } from '@/lib/archive-source/official-url';

import { ARTICLE_HTML, ARTICLE_URL, SOURCE } from './fixtures';

const rules = SOURCE.official_url;
const row = (label: string, href: string) => `<tr><th>${label}</th><td><a href="${href}">link</a></td></tr>`;
const table = (...rows: string[]) => `<table><tbody>${rows.join('')}</tbody></table>`;

describe('pickOfficialUrl', () => {
  it('takes the link in the summary table row', () => {
    expect(pickOfficialUrl(ARTICLE_HTML, ARTICLE_URL, rules)).toBe('https://official.example.com/event/');
  });

  it('prefers the label listed first, whatever the row order', () => {
    const html = table(row('公式サイト', 'https://work.example.com/'), row('特設ページ', 'https://special.example.com/'));
    expect(pickOfficialUrl(html, ARTICLE_URL, rules)).toBe('https://special.example.com/');
  });

  it('matches the label exactly (a row for the work site is not the event site)', () => {
    const html = table(row('公式サイト(作品)', 'https://work.example.com/'));
    expect(pickOfficialUrl(html, ARTICLE_URL, rules)).toBeNull();
  });

  it('skips excluded hosts, subdomains of them and ad links', () => {
    const html = table(
      row('特設ページ', 'https://mobile.twitter.com/sample'),
      row('特設ページ', 'https://ad.example.com/?utm_source=archive'),
      row('特設ページ', 'https://special.example.com/'),
    );
    expect(pickOfficialUrl(html, ARTICLE_URL, rules)).toBe('https://special.example.com/');
  });

  it('falls back to the link selector when no table row is usable', () => {
    const html = `${table(row('特設ページ', 'https://x.com/sample'))}<a class="official-link" href="https://shop.example.net/">shop</a><a class="official-link" href="https://special.example.com/">site</a>`;
    expect(pickOfficialUrl(html, ARTICLE_URL, rules)).toBe('https://special.example.com/');
  });

  it('resolves relative links and ignores non-http ones', () => {
    const html = table(row('特設ページ', 'mailto:info@example.com'), row('公式サイト', '/events/other/'));
    expect(pickOfficialUrl(html, ARTICLE_URL, rules)).toBe('https://archive.example.com/events/other/');
  });

  it('returns null when the article has no official link', () => {
    expect(pickOfficialUrl('<p>no links</p>', ARTICLE_URL, rules)).toBeNull();
  });
});
