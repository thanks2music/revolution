import { describe, expect, it, jest } from '@jest/globals';

import {
  decodeEntities,
  parseArchiveDate,
  resolveArchiveArticle,
  slugFromArticleUrl,
} from '@/lib/archive-source/resolve-article';

import { ARTICLE_HTML, ARTICLE_URL, SOURCE } from './fixtures';

describe('parseArchiveDate', () => {
  it('reads both formats the API returns', () => {
    expect(parseArchiveDate('2000-01-02 03:04:05')).toBe('2000-01-02');
    expect(parseArchiveDate('2000-01-02T03:04:05+09:00')).toBe('2000-01-02');
  });

  it('returns null when there is no date', () => {
    expect(parseArchiveDate(null)).toBeNull();
    expect(parseArchiveDate('')).toBeNull();
    expect(parseArchiveDate('TBA')).toBeNull();
  });
});

describe('slugFromArticleUrl', () => {
  it('takes the last path segment', () => {
    expect(slugFromArticleUrl(ARTICLE_URL)).toBe('sample-event-2019');
    expect(slugFromArticleUrl('https://archive.example.com/events/collabo/a%E3%81%82')).toBe('aあ');
    // A malformed escape is kept as it is
    expect(slugFromArticleUrl('https://archive.example.com/events/a%E3')).toBe('a%E3');
  });

  it('returns null for the site root', () => {
    expect(slugFromArticleUrl('https://archive.example.com/')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('A &#038; B &#x21; &amp; &quot;C&quot; &#215;')).toBe('A & B ! & "C" ×');
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
    // Outside Unicode: does not throw
    expect(() => decodeEntities('&#99999999;')).not.toThrow();
  });
});

describe('resolveArchiveArticle', () => {
  const post = {
    link: ARTICLE_URL,
    title: { rendered: 'サンプル作品 &#215; カフェ' },
    content: { rendered: ARTICLE_HTML },
    starts_at: '2019-01-22 10:00:00',
    ends_at: '2019-02-03 20:00:00',
    event_types: [5, 20, 10],
    _embedded: { 'wp:featuredmedia': [{ source_url: 'https://archive.example.com/wp-content/uploads/kv.jpg' }] },
  };

  it('looks the article up by slug and reads dates, year, type, image and official URL', async () => {
    const fetchJson = jest.fn(async (_url: string): Promise<unknown> => [post]);
    const article = await resolveArchiveArticle(ARTICLE_URL, SOURCE, fetchJson);

    const requested = new URL(fetchJson.mock.calls[0][0]);
    expect(requested.origin + requested.pathname).toBe(SOURCE.api_base);
    expect(requested.searchParams.get('slug')).toBe('sample-event-2019');
    expect(requested.searchParams.get('_embed')).toBe('wp:featuredmedia');
    expect(requested.searchParams.get('_fields')?.split(',')).toEqual(
      expect.arrayContaining(['content', '_links', '_embedded', 'event_types', 'starts_at', 'ends_at']),
    );

    expect(article).toEqual({
      articleUrl: ARTICLE_URL,
      title: 'サンプル作品 × カフェ',
      contentHtml: ARTICLE_HTML,
      startsOn: '2019-01-22',
      endsOn: '2019-02-03',
      eventYear: 2019,
      // The first configured category in the article's order
      eventType: 'pop-up-store',
      featuredImageUrl: 'https://archive.example.com/wp-content/uploads/kv.jpg',
      officialUrl: 'https://official.example.com/event/',
    });
  });

  it('leaves the year and type empty when the API has none', async () => {
    const article = await resolveArchiveArticle(ARTICLE_URL, SOURCE, async () => [
      { content: { rendered: '' }, starts_at: null, event_types: [1] },
    ]);
    expect(article.eventYear).toBeNull();
    expect(article.eventType).toBeNull();
    expect(article.featuredImageUrl).toBeNull();
    expect(article.officialUrl).toBeNull();
  });

  it('throws when the article is not found', async () => {
    await expect(resolveArchiveArticle(ARTICLE_URL, SOURCE, async () => [])).rejects.toThrow('not found');
  });

  it('fetches with the default client and throws on an HTTP error', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([post]), { status: 200 }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }));
    try {
      expect((await resolveArchiveArticle(ARTICLE_URL, SOURCE)).eventYear).toBe(2019);
      await expect(resolveArchiveArticle(ARTICLE_URL, SOURCE)).rejects.toThrow('HTTP 503');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
