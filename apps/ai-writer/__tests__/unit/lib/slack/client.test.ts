/**
 * Layer 2: Slack Web API (chat.postMessage) クライアントの契約テスト
 *
 * 固定したい性質:
 * - Bearer token と JSON (charset=utf-8) で chat.postMessage を叩く
 * - HTTP 200 でも本文が `ok: false` なら失敗として扱う (Web API の仕様)
 * - 失敗・ネットワーク断・タイムアウトのいずれでも例外を投げない
 * - 失敗は Sentry へ warning で送る (エラーコードで fingerprint を束ねる)。成功では送らない
 * - ログに token や本文を出さない
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import { postSlackMessage } from '@/lib/slack/client';

const originalFetch = global.fetch;
const CONFIG = { token: 'xoxb-secret-token', channel: 'C0000000001' };
const MESSAGE = {
  text: 'hello',
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }],
};

let errorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  // Sentry は moduleNameMapper の手動 mock (module 単位の jest.fn())。restoreAllMocks では消えない
  (Sentry.captureMessage as jest.Mock).mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

/** fetch の応答を差し替える */
function mockFetch(init: { status?: number; body?: unknown }): jest.Mock {
  const status = init.status ?? 200;
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (init.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return init.body;
    },
  }));
  global.fetch = fn as unknown as typeof global.fetch;
  return fn as unknown as jest.Mock;
}

/** Sentry へ warning が 1 回、失敗コードを fingerprint にして送られたこと */
function expectFailureCode(code: string): void {
  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Slack notification failed',
    expect.objectContaining({
      level: 'warning',
      fingerprint: ['slack-notification-failed', code],
    })
  );
}

describe('postSlackMessage', () => {
  it('chat.postMessage へ Bearer token と JSON で送り、true を返す', async () => {
    const fetchMock = mockFetch({ body: { ok: true, ts: '1.0' } });

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer xoxb-secret-token');
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(init.body as string)).toMatchObject({
      channel: 'C0000000001',
      text: 'hello',
      blocks: MESSAGE.blocks,
      unfurl_links: false,
    });
    expect(init.signal).toBeDefined();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // ★ Web API は HTTP 200 のまま ok:false を返す。HTTP だけ見ると失敗を見逃す
  it('HTTP 200 でも ok: false なら false を返し、エラーコードで warning を送る', async () => {
    mockFetch({ body: { ok: false, error: 'not_in_channel' } });

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('not_in_channel');
  });

  it('HTTP エラーで本文が JSON でなくても throw せず false を返す', async () => {
    mockFetch({ status: 500 });

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('invalid_response_http_500');
  });

  // プロキシのエラーページなどは HTTP 200 で JSON 以外を返す。`http_200` だと成功と紛らわしい
  it('HTTP 200 でも本文が JSON でなければ失敗として区別する', async () => {
    mockFetch({ status: 200 });

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('invalid_response_http_200');
  });

  it('ネットワーク断でも throw せず false を返す', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof global.fetch;

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('network_error');
  });

  it('タイムアウトでも throw せず false を返す', async () => {
    global.fetch = jest.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as unknown as typeof global.fetch;

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('timeout');
  });

  // AbortSignal.timeout は本文の読み込み中にも発火する。JSON でない本文と取り違えない
  it('本文の読み込み中のタイムアウトも timeout として扱う', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    })) as unknown as typeof global.fetch;

    await expect(postSlackMessage(CONFIG, MESSAGE)).resolves.toBe(false);
    expectFailureCode('timeout');
  });

  it('失敗時のログに token と本文を出さない', async () => {
    mockFetch({ body: { ok: false, error: 'invalid_auth' } });

    await postSlackMessage(CONFIG, MESSAGE);

    const logged = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('invalid_auth');
    expect(logged).not.toContain('xoxb-secret-token');
    expect(logged).not.toContain('hello');
  });
});
