/**
 * Layer 2: cron/rss route の Slack 通知コントラクト
 *
 * 固定したい性質:
 * 1. 未知のエラー (500) だけを通知する。重複 (409)・リトライ可能 (5xx)・入力不備 (400) は送らない
 * 2. 通知は Sentry の flush より前に await する (Cloud Run は応答後に CPU が止まるため)
 *
 * Cloud Run へ token を注入するのは S5 (Scheduler 稼働) から。それまでこの経路は
 * notifyPipelineResult 内で skip されるが、呼び出しの契約は今の時点で固定しておく。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import { DuplicateSlugError, GitHubNetworkError } from '@/lib/errors/github';

const CRON_KEY = 'test-cron-key';
const FEED_URL = 'https://example.com/rss';

jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: jest.fn(async () => [{ payload: { data: Buffer.from(CRON_KEY) } }]),
  })),
}));
jest.mock('@/lib/slack', () => ({ notifyPipelineResult: jest.fn(async () => {}) }));
jest.mock('@/lib/rss/parser', () => ({ parseRssFeed: jest.fn() }));
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

const { parseRssFeed } = require('@/lib/rss/parser') as { parseRssFeed: jest.Mock };
const { notifyPipelineResult } = require('@/lib/slack') as { notifyPipelineResult: jest.Mock };
const { POST } = require('@/app/api/cron/rss/route') as {
  POST: (req: unknown) => Promise<Response>;
};

function makeRequest(body: unknown = { feedUrl: FEED_URL }) {
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

describe('cron/rss route の Slack 通知', () => {
  it('未知のエラー (500) は失敗として 1 回通知する', async () => {
    parseRssFeed.mockRejectedValueOnce(new Error('RSS feed unreachable'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(notifyPipelineResult).toHaveBeenCalledTimes(1);
    expect(notifyPipelineResult.mock.calls[0][0]).toMatchObject({
      outcome: 'failure',
      entrypoint: 'cron',
      sourceUrl: FEED_URL,
      error: 'RSS feed unreachable',
    });
  });

  // 呼び出し順だけでは `void notifyPipelineResult(...)` (await しない) を検出できない。
  // 通知の Promise が解決し終わってから flush が呼ばれることを確かめる
  it('通知の完了を待ってから Sentry の flush に進む', async () => {
    parseRssFeed.mockRejectedValueOnce(new Error('boom'));
    let notifyDone = false;
    let notifyDoneAtFlush: boolean | undefined;
    notifyPipelineResult.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      notifyDone = true;
    });
    (Sentry.flush as jest.Mock).mockImplementationOnce(async () => {
      notifyDoneAtFlush = notifyDone;
      return true;
    });

    await POST(makeRequest());

    expect(notifyDoneAtFlush).toBe(true);
  });

  it('重複 (409) は通知しない', async () => {
    parseRssFeed.mockRejectedValueOnce(
      new DuplicateSlugError('既に生成済み', 'my-slug', 'content/a.mdx')
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(409);
    expect(notifyPipelineResult).not.toHaveBeenCalled();
  });

  // リトライで回復する見込みがあるため対応不要 (Sentry には warning で残る)
  it('リトライ可能な GitHub エラーは通知しない', async () => {
    parseRssFeed.mockRejectedValueOnce(new GitHubNetworkError('ECONNRESET'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(notifyPipelineResult).not.toHaveBeenCalled();
  });

  it('feedUrl が文字列でなければ 400 を返し、通知しない', async () => {
    const res = await POST(makeRequest({ feedUrl: 123 }));

    expect(res.status).toBe(400);
    expect(notifyPipelineResult).not.toHaveBeenCalled();
  });

  // getCronKey() (Secret Manager) は認証より前に動く。その障害中に未認証の
  // リクエストでメンション付き通知が飛ばないこと。route は取得したキーを
  // モジュール内にキャッシュするため、新しいモジュールで検証する
  it('認証前の 500 (Secret Manager の障害) は通知しない', async () => {
    let isolatedPost: ((req: unknown) => Promise<Response>) | undefined;
    let isolatedNotify: jest.Mock | undefined;
    jest.isolateModules(() => {
      const secretManager = require('@google-cloud/secret-manager') as {
        SecretManagerServiceClient: jest.Mock;
      };
      secretManager.SecretManagerServiceClient.mockImplementationOnce(() => ({
        accessSecretVersion: jest.fn(async () => {
          throw new Error('Secret Manager unavailable');
        }),
      }));
      isolatedNotify = (require('@/lib/slack') as { notifyPipelineResult: jest.Mock })
        .notifyPipelineResult;
      isolatedPost = (
        require('@/app/api/cron/rss/route') as { POST: (req: unknown) => Promise<Response> }
      ).POST;
    });

    const res = await isolatedPost!(makeRequest());

    expect(res.status).toBe(500);
    expect(isolatedNotify).not.toHaveBeenCalled();
  });

  // 認証済みでも、本文が JSON として読めないのは送信側の誤り。500 + メンションにしない
  it('本文が不正な JSON なら 400 を返し、通知しない', async () => {
    const res = await POST({
      headers: { get: (name: string) => (name === 'x-cron-key' ? CRON_KEY : null) },
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    expect(res.status).toBe(400);
    expect(notifyPipelineResult).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('feedUrl 未指定 (400) は通知しない', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(notifyPipelineResult).not.toHaveBeenCalled();
  });
});
