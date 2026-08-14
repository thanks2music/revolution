import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `app/sitemap.ts` が **新しいページ種別を実際に列挙しているか**を固定する。
 *
 * ## なぜこのテストが必要か (PR #303 レビュー指摘)
 *
 * `sitemap.ts` を触った動機そのものが「S2 で追加した開催・企画ページが
 * **sitemap から黙って漏れていた**」だった。列挙関数 (`listEventParams` /
 * `listOccurrenceParams`) 単体のテストはあるが、**それが sitemap のエントリへ
 * 写っているか**は誰も確認していなかった。
 *
 * つまり「同じバグがもう一度起きても気づけない」状態だったので、
 * **本 PR が直したバグそのもの**をここで固定する。
 */

const mockGetAllArticles = jest.fn<() => unknown[]>();
const mockGetArticleUrl = jest.fn<(a: { slug: string }) => string>();
const mockListEventParams = jest.fn<() => Promise<{ id: string }[]>>();
const mockListOccurrenceParams = jest.fn<
  () => Promise<{ id: string; occurrence_slug: string }[]>
>();

jest.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://example.com', NEXT_PUBLIC_WP_URL: undefined },
}));
jest.mock('@/lib/mdx/articles', () => ({
  getAllArticles: () => mockGetAllArticles(),
  getArticleUrl: (a: { slug: string }) => mockGetArticleUrl(a),
}));
jest.mock('@/lib/event/queries', () => ({
  listEventParams: () => mockListEventParams(),
}));
jest.mock('@/lib/occurrence/queries', () => ({
  listOccurrenceParams: () => mockListOccurrenceParams(),
}));

async function importSitemap() {
  return (await import('@/app/sitemap')).default;
}

beforeEach(() => {
  jest.resetModules();
  mockGetAllArticles.mockReset().mockReturnValue([]);
  mockGetArticleUrl.mockReset().mockImplementation((a) => `/articles/${a.slug}`);
  mockListEventParams.mockReset().mockResolvedValue([]);
  mockListOccurrenceParams.mockReset().mockResolvedValue([]);
});

const urls = (entries: { url: string }[]) => entries.map((e) => e.url);

describe('sitemap', () => {
  it('always includes the site root', async () => {
    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toContain('https://example.com');
  });

  it('includes event pages from listEventParams', async () => {
    // ★ 本 PR が直したバグの回帰テスト。ここが漏れていた。
    mockListEventParams.mockResolvedValue([{ id: '2' }, { id: '7' }]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toContain('https://example.com/events/2');
    expect(result).toContain('https://example.com/events/7');
  });

  it('includes occurrence pages from listOccurrenceParams', async () => {
    mockListOccurrenceParams.mockResolvedValue([
      { id: '2', occurrence_slug: 'tokyo-shibuya' },
      { id: '2', occurrence_slug: 'osaka-umeda' },
    ]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toContain('https://example.com/events/2/tokyo-shibuya');
    expect(result).toContain('https://example.com/events/2/osaka-umeda');
  });

  it('includes articles via getArticleUrl (single source of truth for the URL form)', async () => {
    // sitemap が URL を自前で組み立てると getArticleUrl と乖離する。
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);

    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toContain('https://example.com/articles/abc');
    expect(mockGetArticleUrl).toHaveBeenCalled();
  });

  it('lists all three page types together', async () => {
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListOccurrenceParams.mockResolvedValue([{ id: '2', occurrence_slug: 'tokyo' }]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    // root + article + event + occurrence
    expect(result).toHaveLength(4);
  });

  /**
   * ★ PR #303 レビュー指摘の回帰テスト。
   *
   * 以前は記事と DB 由来ページを**同じ try/catch で囲んでいた**ため、
   * Supabase の一時障害で `listEventParams` が throw すると
   * **取得済みの記事一覧まで sitemap から丸ごと消えていた**。
   * 「開催・企画が取れなくても記事は残す」という意図をコメントに書きながら、
   * 実装がそうなっていなかった。
   */
  it('keeps the article pages when the database lookup throws', async () => {
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);
    mockListEventParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    // root + article は残り、企画・開催だけが落ちる。
    expect(result).toContain('https://example.com');
    expect(result).toContain('https://example.com/articles/abc');
    expect(result.some((u) => u.includes('/events/'))).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the database pages when the article lookup throws', async () => {
    // 逆向きも同じ。片方の失敗がもう片方を巻き込まない。
    mockGetAllArticles.mockImplementation(() => {
      throw new Error('fs down');
    });
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toContain('https://example.com/events/2');
    expect(result.some((u) => u.includes('/articles/'))).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('still returns the root when everything fails', async () => {
    mockGetAllArticles.mockImplementation(() => {
      throw new Error('fs down');
    });
    mockListEventParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toEqual(['https://example.com']);
    error.mockRestore();
  });
});
