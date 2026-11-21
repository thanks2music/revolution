import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import { notifySlack } from '@/lib/slack/notify';

/**
 * 公開サイトから Slack の 2 つのチャンネル (要対応・お知らせ) へ送る口。
 * 呼び出し元のユーザーの操作を失敗させないため、例外を投げない。
 */
const env = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_ATTENTION_CHANNEL_ID: 'C_ATTENTION',
  SLACK_NOTICE_CHANNEL_ID: 'C_NOTICE',
  SLACK_MENTION_USER_ID: 'U_BOSS',
};
const message = {
  text: '口コミが確認待ちになりました',
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '口コミが確認待ちになりました' } }],
};

let fetchMock: jest.Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>();
  global.fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function sentBody(): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
}

describe('notifySlack', () => {
  it('要対応は、要対応のチャンネルへ BOSS へのメンション付きで送る', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await expect(notifySlack('attention', message, env)).resolves.toBe(true);

    const body = sentBody();
    expect(body.channel).toBe('C_ATTENTION');
    expect(body.text).toBe('<@U_BOSS> 口コミが確認待ちになりました');
    expect(body.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '<@U_BOSS>' } },
      ...message.blocks,
    ]);
  });

  it('お知らせは、お知らせのチャンネルへメンションなしで送る', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await expect(notifySlack('notice', message, env)).resolves.toBe(true);

    const body = sentBody();
    expect(body.channel).toBe('C_NOTICE');
    expect(body.text).toBe(message.text);
    expect(body.blocks).toEqual(message.blocks);
  });

  it('blocks が既に上限 (50) なら、メンションは本文にだけ置き、blocks は増やさない', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const fullBlocks = Array.from({ length: 50 }, () => message.blocks[0]);

    await notifySlack('attention', { text: message.text, blocks: fullBlocks }, env);

    const body = sentBody();
    expect(body.text).toBe('<@U_BOSS> 口コミが確認待ちになりました');
    expect(body.blocks).toHaveLength(50);
  });

  it('blocks が 49 個なら、メンションのブロックを足して 50 個にする', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const blocks = Array.from({ length: 49 }, () => message.blocks[0]);

    await notifySlack('attention', { text: message.text, blocks }, env);

    expect(sentBody().blocks).toHaveLength(50);
  });

  it('メンション先が未設定なら、要対応でもメンションなしで送る', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { SLACK_MENTION_USER_ID: _omitted, ...withoutMention } = env;

    await notifySlack('attention', message, withoutMention);

    expect(sentBody().text).toBe(message.text);
  });

  it.each([
    ['token', { ...env, SLACK_BOT_TOKEN: undefined }],
    ['チャンネル', { ...env, SLACK_ATTENTION_CHANNEL_ID: undefined }],
    ['1Password の参照のままの token', { ...env, SLACK_BOT_TOKEN: 'op://vault/slack/token' }],
  ])('%s が未設定なら送らず、エラーにもしない', async (_label, partialEnv) => {
    await expect(notifySlack('attention', message, partialEnv)).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('送信に失敗しても例外を投げず、エラーコードを Sentry に残す', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })));

    await expect(notifySlack('notice', message, env)).resolves.toBe(false);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Slack notification failed',
      expect.objectContaining({
        level: 'warning',
        fingerprint: ['slack-notification-failed', 'not_in_channel'],
        tags: { destination: 'notice' },
      }),
    );
  });

  it('失敗の記録そのもの (Sentry) が例外を投げても、例外を投げない', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })));
    (Sentry.captureMessage as jest.Mock).mockImplementationOnce(() => {
      throw new Error('sentry is down');
    });

    await expect(notifySlack('notice', message, env)).resolves.toBe(false);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('失敗のログと Sentry に token と本文を出さない', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await notifySlack('notice', message, env);

    const logged = JSON.stringify([
      (console.error as jest.Mock).mock.calls,
      (Sentry.captureMessage as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain('xoxb-test-token');
    expect(logged).not.toContain(message.text);
  });
});
