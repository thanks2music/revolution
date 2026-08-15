/**
 * Layer 2: cron/rss route の Sentry 計装コントラクト。
 *
 * この route は Cloud Scheduler から無人で叩かれる本番経路であり、
 * **観測できるのは Sentry に届いたものだけ**。よって以下を契約として固定する:
 *
 * 1. 未知のエラーは captureException される (対応すべきものが消えない)
 * 2. DuplicateSlugError は captureException されない (想定内。枠を食わせない)
 * 3. どちらの経路でも flush される (Cloud Run は返した後に CPU が止まるため、
 *    flush を待たないとイベントが送信前に消える)
 *
 * ⚠️ この route は独自の runMdxPipeline() を内包し、
 * ArticleGenerationMdxService.generateMdxFromRSS() を呼んでいない。
 * よって service 側の計装ではこの経路を一切カバーできない。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import { DuplicateSlugError } from '@/lib/errors/github';

const CRON_KEY = 'test-cron-key';

// Secret Manager を叩かせない (認証を通すためだけのモック)
jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: jest.fn(async () => [
      { payload: { data: Buffer.from(CRON_KEY) } },
    ]),
  })),
}));

// パイプライン最初の外部依存。ここを throw させて catch 節へ落とす
jest.mock('@/lib/rss/parser', () => ({
  parseRssFeed: jest.fn(),
}));

// route が import する残りの重い依存を無害化する
jest.mock('@/lib/github/create-mdx-pr', () => ({ createMdxPr: jest.fn() }));
jest.mock('@/lib/firestore/event-deduplication', () => ({
  checkEventDuplication: jest.fn(),
  registerNewEvent: jest.fn(),
  updateEventStatus: jest.fn(),
}));
jest.mock('@/lib/claude/rss-extractor', () => ({ extractFromRss: jest.fn() }));
jest.mock('@/lib/claude/metadata-generator', () => ({ generateArticleMetadata: jest.fn() }));
jest.mock('@/lib/mdx/template-generator', () => ({ generateMdxArticle: jest.fn() }));
jest.mock('@/lib/config', () => ({
  resolveWorkSlug: jest.fn(),
  resolveStoreSlug: jest.fn(),
  resolveEventTypeSlug: jest.fn(),
}));
jest.mock('@/lib/utils/category-builder', () => ({ buildCategories: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseRssFeed } = require('@/lib/rss/parser') as { parseRssFeed: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('@/app/api/cron/rss/route') as {
  POST: (req: unknown) => Promise<Response>;
};

/** 認証を通す最小の Request 相当オブジェクト。 */
function makeRequest(body: unknown = { feedUrl: 'https://example.com/rss' }) {
  return {
    headers: { get: (name: string) => (name === 'x-cron-key' ? CRON_KEY : null) },
    json: async () => body,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('cron/rss route の Sentry 計装', () => {
  it('未知のエラーは captureException され 500 を返す', async () => {
    parseRssFeed.mockRejectedValueOnce(new Error('RSS feed unreachable'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    const [captured, options] = (Sentry.captureException as jest.Mock).mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('RSS feed unreachable');
    // 経路を tag で区別できないと、service 側の計装と混ざって切り分け不能になる
    expect(options.tags.entrypoint).toBe('cron');
  });

  it('DuplicateSlugError は captureException されず 409 を返す', async () => {
    parseRssFeed.mockRejectedValueOnce(
      new DuplicateSlugError('既に生成済み', 'my-slug', 'content/collabo-cafe/a/x.mdx')
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(409);
    // 想定内の重複を Issue にすると無料枠 (5K/月) が溶ける
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('成功時も含め、レスポンスを返す前に flush される', async () => {
    parseRssFeed.mockRejectedValueOnce(new Error('boom'));

    await POST(makeRequest());

    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('DuplicateSlugError の経路でも flush される', async () => {
    parseRssFeed.mockRejectedValueOnce(
      new DuplicateSlugError('既に生成済み', 'my-slug', 'content/a.mdx')
    );

    await POST(makeRequest());

    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('feedUrl 未指定の 400 は captureException しない (ユーザー入力起因)', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
