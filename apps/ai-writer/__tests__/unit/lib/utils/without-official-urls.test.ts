import { describe, expect, it } from '@jest/globals';

import { removeLinksToClosedSite, withoutOfficialUrls } from '@/lib/utils/without-official-urls';

describe('withoutOfficialUrls', () => {
  it('clears the official URL and each occurrence URL, keeping the rest', () => {
    const extraction = {
      作品名: 'Work',
      公式サイトURL: 'https://gone.example.com/',
      event_data: {
        event_name: 'Event',
        occurrences: [
          { venue_label: 'A', official_url: 'https://gone.example.com/a' },
          { venue_label: 'B', official_url: null },
        ],
      },
    };
    expect(withoutOfficialUrls(extraction)).toEqual({
      作品名: 'Work',
      公式サイトURL: '',
      event_data: {
        event_name: 'Event',
        occurrences: [
          { venue_label: 'A', official_url: null },
          { venue_label: 'B', official_url: null },
        ],
      },
    });
    // The input is not changed
    expect(extraction.event_data.occurrences[0].official_url).toBe('https://gone.example.com/a');
  });

  it('leaves event data without occurrences as it is', () => {
    expect(withoutOfficialUrls({ 公式サイトURL: 'https://x.example/', event_data: undefined }).event_data).toBeUndefined();
    expect(withoutOfficialUrls({ 公式サイトURL: 'https://x.example/', event_data: { a: 1 } }).event_data).toEqual({ a: 1 });
  });
});

describe('removeLinksToClosedSite', () => {
  const article = [
    '| 項目 | 内容 |',
    '|------|------|',
    '| Site | [page](https://gone.example.com) |',
    '| Menu | [menu](https://WWW.Gone.Example.com/menu.pdf) |',
    '| Place | Venue |',
    '| Link | [page]({{公式サイトURL}}) |',
    '| Empty | [page]() |',
    '| Map | [map](https://maps.example.org/?q=gone.example.com) |',
    '',
    'See [the official site](https://gone.example.com/event/) for details.',
    'Goods are on sale.',
  ].join('\n');

  it('with the host scope, removes every line linking to the closed host, whatever the path or spelling', () => {
    const { content, removed } = removeLinksToClosedSite(article, 'https://gone.example.com/event/', 'host');
    expect(content).toBe(
      [
        '| 項目 | 内容 |',
        '|------|------|',
        '| Place | Venue |',
        // The host only appears in another site's query string
        '| Map | [map](https://maps.example.org/?q=gone.example.com) |',
        '',
        'Goods are on sale.',
      ].join('\n'),
    );
    expect(removed).toHaveLength(5);
  });

  it('with the page scope, removes only links to that page (ignoring case, www, a trailing slash and the query)', () => {
    const text = [
      '| Event | [page](https://WWW.gone.example.com/event?utm_source=x) |',
      '| Store | [store](https://gone.example.com/stores/) |',
      'Read [the page](https://gone.example.com/event/) for details.',
    ].join('\n');
    const { content, removed } = removeLinksToClosedSite(text, 'https://gone.example.com/event/', 'page');
    expect(content).toBe('| Store | [store](https://gone.example.com/stores/) |');
    expect(removed).toHaveLength(2);
  });

  it('still removes empty links when the closed URL cannot be parsed', () => {
    const { content } = removeLinksToClosedSite('| Empty | [page]() |\nkeep', 'not a url', 'host');
    expect(content).toBe('keep');
  });
});
