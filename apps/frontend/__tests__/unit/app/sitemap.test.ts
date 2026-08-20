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
const mockListTitleParams = jest.fn<() => Promise<{ slug: string }[]>>();

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
jest.mock('@/lib/title/queries', () => ({
  listTitleParams: () => mockListTitleParams(),
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
  mockListTitleParams.mockReset().mockResolvedValue([]);
});

/**
 * `@sentry/nextjs` の手動 mock を **sitemap.ts と同じモジュールレジストリから**取得する。
 *
 * 本 suite は `jest.resetModules()` + 動的 import で sitemap を読み直すため、
 * テストファイル冒頭で静的 import した Sentry は sitemap.ts が掴むものとは
 * **別インスタンス**になり、呼び出しが観測できない。必ず importSitemap() の後に呼ぶこと。
 */
async function importSentryMock() {
  return (await import('@sentry/nextjs')) as unknown as {
    captureException: jest.Mock;
  };
}

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

  it('includes title hub and aggregate views from listTitleParams', async () => {
    // ★ 「ページ種別を増やしたら sitemap にも足す」の回帰テスト (S2 作品ハブ)。
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toContain('https://example.com/titles/jujutsu-kaisen');
    expect(result).toContain('https://example.com/titles/jujutsu-kaisen/articles');
    expect(result).toContain('https://example.com/titles/jujutsu-kaisen/occurrences');
    // カテゴリ絞り込みビューは意図的に載せない (canonical は /articles/{ULID} 側)。
    expect(result.some((u) => u.includes('/articles/collabo-cafe'))).toBe(false);
  });

  it('lists all page types together', async () => {
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListOccurrenceParams.mockResolvedValue([{ id: '2', occurrence_slug: 'tokyo' }]);
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    // root + article + event + occurrence + title (hub / articles / occurrences)
    expect(result).toHaveLength(7);
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
    // sitemap からページが消えるのは SEO 事故。console だけでは誰も気づけないので
    // Sentry に届くことまで固定する (tags で articles / events を切り分ける)。
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'events' },
    });
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
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'articles' },
    });
    error.mockRestore();
  });

  it('keeps the other page types when the title lookup throws', async () => {
    // 作品ハブの追加で既存種別が巻き込まれない (種別ごとの独立 try/catch)。
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListTitleParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toContain('https://example.com/articles/abc');
    expect(result).toContain('https://example.com/events/2');
    expect(result.some((u) => u.includes('/titles/'))).toBe(false);
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'titles' },
    });
    error.mockRestore();
  });

  it('still returns the root when everything fails', async () => {
    mockGetAllArticles.mockImplementation(() => {
      throw new Error('fs down');
    });
    mockListEventParams.mockRejectedValue(new Error('db down'));
    mockListTitleParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toEqual(['https://example.com']);
    error.mockRestore();
  });
});
