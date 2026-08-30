import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * `app/sitemap.ts` の検査。**2 つの関心を分けている**。
 *
 * | describe | 何を守るか | いつ変わるか |
 * |---|---|---|
 * | `sitemap (公開ポリシー)` | いま何を載せる / 載せないか | noindex 解除時に反転する |
 * | `buildS2Pages (列挙ロジック)` | S2 の各種別が正しく URL へ写るか | 変わらない |
 *
 * ## なぜ分けたか (2026-08-25 noindex 対応)
 *
 * S2 ルート群を noindex にしたため sitemap から外した (`INCLUDE_S2_ROUTES = false`)。
 * ここで列挙テストごと消すと、**PR #303 で直した「S2 ページが sitemap から黙って
 * 漏れる」バグの回帰防止が失われる**。解除時に壊れていることに気づけない。
 *
 * そこで `buildS2Pages` を export し、**フラグと無関係に列挙ロジックを検査し続ける**。
 * 公開ポリシー側だけが解除時に反転する。
 *
 * ## 元々の存在理由 (PR #303 レビュー指摘)
 *
 * `sitemap.ts` を触った動機が「S2 で追加した開催・企画ページが**sitemap から
 * 黙って漏れていた**」だった。列挙関数単体のテストはあったが、**それが sitemap の
 * エントリへ写っているか**は誰も確認していなかった。
 */

const mockGetAllArticles = jest.fn<() => unknown[]>();
const mockGetArticleUrl = jest.fn<(a: { slug: string }) => string>();
const mockListEventParams = jest.fn<() => Promise<{ id: string }[]>>();
const mockListOccurrenceParams = jest.fn<
  () => Promise<{ id: string; occurrence_slug: string }[]>
>();
const mockListTitleParams = jest.fn<() => Promise<{ slug: string }[]>>();
const mockListVenueParams = jest.fn<() => Promise<{ slug: string }[]>>();

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
jest.mock('@/lib/venue/queries', () => ({
  listVenueParams: () => mockListVenueParams(),
}));

async function importSitemap() {
  return (await import('@/app/sitemap')).default;
}

async function importBuildS2Pages() {
  return (await import('@/app/sitemap')).buildS2Pages;
}

beforeEach(() => {
  jest.resetModules();
  mockGetAllArticles.mockReset().mockReturnValue([]);
  mockGetArticleUrl.mockReset().mockImplementation((a) => `/articles/${a.slug}`);
  mockListEventParams.mockReset().mockResolvedValue([]);
  mockListOccurrenceParams.mockReset().mockResolvedValue([]);
  mockListTitleParams.mockReset().mockResolvedValue([]);
  mockListVenueParams.mockReset().mockResolvedValue([]);
});

/**
 * `@sentry/nextjs` の手動 mock を **sitemap.ts と同じモジュールレジストリから**取得する。
 *
 * 本 suite は `jest.resetModules()` + 動的 import で sitemap を読み直すため、
 * テストファイル冒頭で静的 import した Sentry は sitemap.ts が掴むものとは
 * **別インスタンス**になり、呼び出しが観測できない。必ず import の後に呼ぶこと。
 */
async function importSentryMock() {
  return (await import('@sentry/nextjs')) as unknown as {
    captureException: jest.Mock;
  };
}

const urls = (entries: { url: string }[]) => entries.map((e) => e.url);

/** S2 に属する URL かどうか (公開ポリシーの検査用)。 */
const isS2 = (u: string) =>
  /\/(titles|events|venues)(\/|$)/.test(u.replace('https://example.com', ''));

describe('sitemap (公開ポリシー)', () => {
  it('サイトルートは常に載る', async () => {
    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toContain('https://example.com');
  });

  it('記事は getArticleUrl 経由で載る (URL 形式の真実源を 1 つに保つ)', async () => {
    // sitemap が URL を自前で組み立てると getArticleUrl と乖離する。
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);

    const sitemap = await importSitemap();
    expect(urls(await sitemap())).toContain('https://example.com/articles/abc');
    expect(mockGetArticleUrl).toHaveBeenCalled();
  });

  it('🔴 noindex 期間中は S2 ルート群を一切載せない', async () => {
    // noindex の URL を sitemap に載せるのは矛盾で、Search Console が
    // 「送信された URL に noindex タグが追加されています」と警告する。
    // データが揃っていても載らないことを固定する。
    mockGetAllArticles.mockReturnValue([{ slug: 'abc', date: '2026-01-01' }]);
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListOccurrenceParams.mockResolvedValue([{ id: '2', occurrence_slug: 'tokyo' }]);
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);
    mockListVenueParams.mockResolvedValue([{ slug: 'box-cafe-and-space-gems-shibuya' }]);

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result.filter(isS2)).toEqual([]);
    // 記事とルートは残る = 「S2 を外す」であって「sitemap を空にする」ではない。
    expect(result).toEqual(['https://example.com', 'https://example.com/articles/abc']);
  });

  /**
   * ★ PR #303 レビュー指摘の回帰テスト。
   *
   * 以前は記事と DB 由来ページを**同じ try/catch で囲んでいた**ため、
   * Supabase の一時障害で列挙関数が throw すると**取得済みの記事一覧まで
   * sitemap から丸ごと消えていた**。
   */
  it('記事の取得が throw しても root は残り、Sentry に届く', async () => {
    mockGetAllArticles.mockImplementation(() => {
      throw new Error('fs down');
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const sitemap = await importSitemap();
    const result = urls(await sitemap());

    expect(result).toEqual(['https://example.com']);
    expect(error).toHaveBeenCalled();
    // sitemap からページが消えるのは SEO 事故。console だけでは誰も気づけない。
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'articles' },
    });
    error.mockRestore();
  });
});

/**
 * S2 の列挙ロジック。**noindex 期間中も検査し続ける**ため `buildS2Pages` を直接叩く。
 *
 * ここが壊れたまま noindex を解除すると、PR #303 で直したバグがそのまま再発する。
 */
describe('buildS2Pages (列挙ロジック)', () => {
  const BASE = 'https://example.com';

  it('企画ページを listEventParams から列挙する', async () => {
    mockListEventParams.mockResolvedValue([{ id: '2' }, { id: '7' }]);

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/events/2');
    expect(result).toContain('https://example.com/events/7');
  });

  it('開催ページを listOccurrenceParams から列挙する', async () => {
    mockListOccurrenceParams.mockResolvedValue([
      { id: '2', occurrence_slug: 'tokyo-shibuya' },
      { id: '2', occurrence_slug: 'osaka-umeda' },
    ]);

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/events/2/tokyo-shibuya');
    expect(result).toContain('https://example.com/events/2/osaka-umeda');
  });

  it('作品ハブと集約ビューを listTitleParams から列挙する', async () => {
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/titles/jujutsu-kaisen');
    expect(result).toContain('https://example.com/titles/jujutsu-kaisen/articles');
    expect(result).toContain('https://example.com/titles/jujutsu-kaisen/occurrences');
    // カテゴリ絞り込みビューは意図的に載せない (canonical は /articles/{ULID} 側)。
    expect(result.some((u) => u.includes('/articles/collabo-cafe'))).toBe(false);
  });

  it('会場ページを listVenueParams から列挙する', async () => {
    mockListVenueParams.mockResolvedValue([{ slug: 'box-cafe-and-space-gems-shibuya' }]);

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/venues/box-cafe-and-space-gems-shibuya');
  });

  it('全種別をまとめて列挙する', async () => {
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListOccurrenceParams.mockResolvedValue([{ id: '2', occurrence_slug: 'tokyo' }]);
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);
    mockListVenueParams.mockResolvedValue([{ slug: 'box-cafe-and-space-gems-shibuya' }]);

    const buildS2Pages = await importBuildS2Pages();
    // event 1 + occurrence 1 + title (hub / articles / occurrences) 3 + venue 1
    expect(await buildS2Pages(BASE)).toHaveLength(6);
  });

  it('作品の取得が throw しても他種別は残る (種別ごとの独立 try/catch)', async () => {
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListVenueParams.mockResolvedValue([{ slug: 'shibuya' }]);
    mockListTitleParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/events/2');
    expect(result).toContain('https://example.com/venues/shibuya');
    expect(result.some((u) => u.includes('/titles/'))).toBe(false);
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'titles' },
    });
    error.mockRestore();
  });

  it('会場の取得が throw しても他種別は残る', async () => {
    mockListEventParams.mockResolvedValue([{ id: '2' }]);
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);
    mockListVenueParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/events/2');
    expect(result).toContain('https://example.com/titles/jujutsu-kaisen');
    expect(result.some((u) => u.includes('/venues/'))).toBe(false);
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'venues' },
    });
    error.mockRestore();
  });

  it('企画の取得が throw しても他種別は残る', async () => {
    mockListTitleParams.mockResolvedValue([{ slug: 'jujutsu-kaisen' }]);
    mockListEventParams.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const buildS2Pages = await importBuildS2Pages();
    const result = urls(await buildS2Pages(BASE));

    expect(result).toContain('https://example.com/titles/jujutsu-kaisen');
    expect(result.some((u) => u.includes('/events/'))).toBe(false);
    const sentry = await importSentryMock();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { sitemap: 'events' },
    });
    error.mockRestore();
  });
});
