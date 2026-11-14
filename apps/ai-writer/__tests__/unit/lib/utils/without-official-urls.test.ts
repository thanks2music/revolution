import { describe, expect, it } from '@jest/globals';

import { removeLinesContaining, withoutOfficialUrls } from '@/lib/utils/without-official-urls';

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

describe('removeLinesContaining', () => {
  const table = [
    '| 項目 | 内容 |',
    '|------|------|',
    '| Site | [page](https://gone.example.com/event/) |',
    '| Place | Venue |',
    '| Link | [page]({{公式サイトURL}}) |',
    '| Empty | [page]() |',
    '',
    'See [the official site]({{公式サイトURL}}) for details.',
  ].join('\n');

  it('removes the table rows and sentences that contain any of the strings', () => {
    expect(removeLinesContaining(table, ['https://gone.example.com/event/', '{{公式サイトURL}}', ']()'])).toBe(
      ['| 項目 | 内容 |', '|------|------|', '| Place | Venue |', ''].join('\n'),
    );
  });

  it('keeps the other lines and ignores empty needles', () => {
    const text = 'Line one\nLine two';
    expect(removeLinesContaining(text, ['https://gone.example.com/event/'])).toBe(text);
    expect(removeLinesContaining(table, [''])).toBe(table);
  });
});
