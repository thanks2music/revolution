import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { postSlackMessage } from '@revolution/slack/post-message';

/**
 * 全アプリで共有する Slack の送信 (`chat.postMessage`)。
 * 例外を投げない・本文の `ok` を見る・再送しない、の 3 つを確かめる。
 */
const target = { token: 'xoxb-test-token', channel: 'C0123' };
const message = { text: 'hello', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }] };

let fetchMock: jest.Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>();
  global.fetch = fetchMock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('postSlackMessage', () => {
  it('Bearer token と JSON で送り、ok を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await expect(postSlackMessage(target, message)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-test-token');
    expect(JSON.parse(init?.body as string)).toEqual({
      channel: 'C0123',
      text: 'hello',
      blocks: message.blocks,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('HTTP 200 でも本文が ok: false なら、そのエラーコードで失敗を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'channel_not_found' }));

    await expect(postSlackMessage(target, message)).resolves.toEqual({
      ok: false,
      code: 'channel_not_found',
    });
  });

  it('HTTP エラーで本文にエラーコードが無ければ、HTTP のステータスで失敗を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));

    await expect(postSlackMessage(target, message)).resolves.toEqual({ ok: false, code: 'http_429' });
  });

  it('本文が JSON でなければ、HTTP 200 でも失敗として区別する', async () => {
    fetchMock.mockResolvedValue(new Response('<html>proxy error</html>', { status: 200 }));

    await expect(postSlackMessage(target, message)).resolves.toEqual({
      ok: false,
      code: 'invalid_response_http_200',
    });
  });

  it('ネットワークの失敗でも例外を投げない', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(postSlackMessage(target, message)).resolves.toEqual({
      ok: false,
      code: 'network_error',
    });
  });

  it('時間切れは timeout として返す', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(postSlackMessage(target, message)).resolves.toEqual({ ok: false, code: 'timeout' });
  });

  it('本文の読み込み中の時間切れも timeout として返す', async () => {
    const response = new Response('{}', { status: 200 });
    jest
      .spyOn(response, 'json')
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    fetchMock.mockResolvedValue(response);

    await expect(postSlackMessage(target, message)).resolves.toEqual({ ok: false, code: 'timeout' });
  });

  it('失敗しても再送しない (二重投稿を避けるため)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'ratelimited' }, 429));

    await postSlackMessage(target, message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
