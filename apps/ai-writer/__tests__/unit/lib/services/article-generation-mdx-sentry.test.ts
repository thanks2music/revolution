/**
 * Layer 2: MDX パイプライン全体 catch の Sentry 計装コントラクト。
 *
 * `generateMdxFromRSS()` は全 step を包む catch で `{ success: false }` を返すため、
 * どの step で落ちても例外が呼び出し元へ出ない。Sentry 導入以前は本番で
 * 「失敗した」以上のことが何も分からなかった。本 PR の主目的の計装なので契約化する。
 *
 * ⚠️ この catch がカバーするのは SSE / CLI 経路。cron 経路
 * (`app/api/cron/rss/route.ts`) は独自の runMdxPipeline() を持ち本メソッドを
 * 呼ばないため、別途 route 側で計装している (rss-sentry.test.ts)。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

// パイプライン最初の外部呼び出し。ここを throw させて全体 catch に落とす
jest.mock('@/lib/utils/html-extractor', () => ({
  extractArticleHtml: jest.fn(),
  extractContentHtml: jest.fn(),
  extractPageLinks: jest.fn(),
}));

// GitHub 系は @octokit/rest (ESM) を引き込み、next/jest の transformIgnorePatterns で
// 変換されず "Cannot use import statement outside a module" になる。import 評価を止める。
jest.mock('@/lib/github/create-mdx-pr', () => ({ createMdxPr: jest.fn() }));
jest.mock('@/lib/github/pr-status', () => ({ getPrStatusByCanonicalKey: jest.fn() }));
jest.mock('@/lib/firestore/event-deduplication', () => ({
  checkEventDuplication: jest.fn(),
  registerNewEvent: jest.fn(),
  updateEventStatus: jest.fn(),
}));

// 画像アップロード系は uuid@14 (ESM-only) を引き込むため同様に止める
jest.mock('@/lib/services/r2-storage.service', () => ({ getR2StorageService: jest.fn() }));
jest.mock('@/lib/services/og-image-upload.service', () => ({
  uploadOgImageForArticle: jest.fn(),
  OgImageUploadService: jest.fn(),
}));
jest.mock('@/lib/services/article-image-upload.service', () => ({
  uploadArticleImages: jest.fn(),
  ArticleImageUploadService: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { extractArticleHtml } = require('@/lib/utils/html-extractor') as {
  extractArticleHtml: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ArticleGenerationMdxService,
} = require('@/lib/services/article-generation-mdx.service') as {
  ArticleGenerationMdxService: new () => {
    generateMdxFromRSS: (req: unknown) => Promise<{ success: boolean; error?: string }>;
  };
};

const rssItem = {
  title: '作品名×店舗名コラボカフェ2026',
  link: 'https://example.com/news/1',
  content: '<p>本文</p>',
  contentSnippet: '本文',
  pubDate: new Date('2026-08-15T00:00:00Z').toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('generateMdxFromRSS の全体 catch', () => {
  it('パイプラインが落ちたら captureException し、元の error を第 1 引数に渡す', async () => {
    const boom = new Error('記事HTMLの取得に失敗');
    extractArticleHtml.mockRejectedValueOnce(boom);

    const service = new ArticleGenerationMdxService();
    const result = await service.generateMdxFromRSS({ rssItem, dryRun: true });

    // 呼び出し元への戻り値は従来どおり (振る舞いを変えない)
    expect(result.success).toBe(false);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured, options] = (Sentry.captureException as jest.Mock).mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    // 加工したメッセージではなく元の error オブジェクトを渡す
    // (stack trace が失われると source map を入れた意味がなくなる)
    expect(captured).toBe(boom);
    expect(options.tags.pipeline).toBe('mdx');
  });

  it('成功する必要はないが、例外時も戻り値の契約 ({ success: false }) を守る', async () => {
    extractArticleHtml.mockRejectedValueOnce(new Error('boom'));

    const service = new ArticleGenerationMdxService();
    const result = await service.generateMdxFromRSS({ rssItem, dryRun: true });

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'boom' }));
  });
});
