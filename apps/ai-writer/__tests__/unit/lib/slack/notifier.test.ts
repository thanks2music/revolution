import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import {
  sendSlackNotification,
  sendSimpleSlackMessage,
  type SlackNotificationParams,
} from '@/lib/slack/notifier';

const originalFetch = global.fetch;
const originalWebhookUrl = process.env.SLACK_WEBHOOK_URL;

beforeEach(() => {
  // console を黙らせる (未設定時の warn / 失敗時の error が出力を汚すため)
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Sentry は moduleNameMapper で手動 mock に解決される module 単位の jest.fn()。
  // restoreAllMocks では消えないため明示的に clear する。
  (Sentry.captureMessage as jest.Mock).mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalWebhookUrl === undefined) {
    delete process.env.SLACK_WEBHOOK_URL;
  } else {
    process.env.SLACK_WEBHOOK_URL = originalWebhookUrl;
  }
  jest.restoreAllMocks();
});

/** `fetch` の応答を最小限で差し替える。 */
function mockFetch(init: { ok: boolean; status?: number; body?: string }): jest.Mock {
  const fn = jest.fn(async () => ({
    ok: init.ok,
    status: init.status ?? 200,
    statusText: '',
    text: async () => init.body ?? '',
  }));
  global.fetch = fn as unknown as typeof global.fetch;
  return fn as unknown as jest.Mock;
}

const params: SlackNotificationParams = {
  type: 'pr_failed',
  error: new Error('GitHub API rate limit exceeded'),
  context: {
    postId: '01kes3xx1qab2c3d',
    workSlug: 'sample-work',
    title: '作品名×店舗名2026',
  },
};

describe('sendSlackNotification', () => {
  // ★ 本 suite の主眼。SLACK_WEBHOOK_URL 未設定は「失敗」ではなく「スキップ」である。
  //   旧実装は getSlackWebhookUrl() が throw し、それが try の外で呼ばれていたため、
  //   create-mdx-pr.ts の catch 節から呼ばれると PR 作成の本来のエラーを覆い隠していた。
  it('SLACK_WEBHOOK_URL が未設定でも throw せずスキップする', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = mockFetch({ ok: true });

    await expect(sendSlackNotification(params)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空文字の SLACK_WEBHOOK_URL も未設定として扱う', async () => {
    process.env.SLACK_WEBHOOK_URL = '';
    const fetchMock = mockFetch({ ok: true });

    await expect(sendSlackNotification(params)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('設定済みなら webhook URL へ POST する', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    const fetchMock = mockFetch({ ok: true });

    await sendSlackNotification(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.example/T000/B000/xxx');
    expect(init.method).toBe('POST');
  });

  // 通知失敗がメイン処理を止めないこと (JSDoc の「例外は再スローしない」の担保)
  it('Slack API がエラーを返しても throw しない', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    mockFetch({ ok: false, status: 500, body: 'internal error' });

    await expect(sendSlackNotification(params)).resolves.toBeUndefined();
  });

  it('fetch 自体が落ちても throw しない', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof global.fetch;

    await expect(sendSlackNotification(params)).resolves.toBeUndefined();
  });
});

describe('sendSimpleSlackMessage', () => {
  it('SLACK_WEBHOOK_URL が未設定でも throw せずスキップする', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = mockFetch({ ok: true });

    await expect(sendSimpleSlackMessage('hello')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('設定済みなら webhook URL へ POST する', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    const fetchMock = mockFetch({ ok: true });

    await sendSimpleSlackMessage('hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 回帰テスト: 呼び出し元 (create-mdx-pr.ts) の構造を再現する
//
// create-mdx-pr.ts の catch 節は「元エラーをログ → Firestore 更新 →
// sendSlackNotification → 元エラーを再スロー」の順で、Slack 通知が throw すると
// 再スローに到達せず、呼び出し側が受け取るエラーが差し替わってしまう。
// 18 本のバッチ実走で PR 作成が失敗したとき、真因が特定できなくなるため
// この性質を明示的に固定する。
// ────────────────────────────────────────────────────────────────────────────
describe('呼び出し元の catch 節で元エラーが保持されること (回帰)', () => {
  it('webhook 未設定でも、再スローされるのは元エラーである', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    mockFetch({ ok: true });

    const originalError = new Error('Branch already exists: ai-writer/mdx-collabo-cafe-xxx');

    // create-mdx-pr.ts:418-447 と同じ順序
    const run = async (): Promise<never> => {
      try {
        throw originalError;
      } catch (error) {
        await sendSlackNotification({
          ...params,
          error: error instanceof Error ? error : new Error('Unknown error'),
        });
        throw error;
      }
    };

    await expect(run()).rejects.toThrow('Branch already exists: ai-writer/mdx-collabo-cafe-xxx');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sentry 計装のコントラクト (Sentry 導入 PR で追加)
//
// 通知が届いていないこと自体は気づきにくいので Sentry へ流すが、業務処理は
// 継続しているため **warning 止まり**にしてある (Developer plan の priority は
// log level で決まり、warning = Medium = メール通知の対象外)。
// error に格上げすると、Slack 未設定の環境で毎回メールが飛ぶことになる。
// ────────────────────────────────────────────────────────────────────────────
describe('Sentry への通知 (計装コントラクト)', () => {
  it('送信失敗は warning として captureMessage する', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    mockFetch({ ok: false, status: 500, body: 'internal error' });

    await sendSlackNotification(params);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0] as [
      string,
      { level: string },
    ];
    expect(options.level).toBe('warning');
  });

  // 未設定は「失敗」ではなく「スキップ」。ここを拾うと、Slack を使っていない
  // 環境で記事生成のたびにイベントが飛び無料枠を溶かす。
  it('SLACK_WEBHOOK_URL 未設定のスキップでは captureMessage しない', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    mockFetch({ ok: true });

    await sendSlackNotification(params);
    await sendSimpleSlackMessage('hello');

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('送信成功時は captureMessage しない', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/xxx';
    mockFetch({ ok: true });

    await sendSlackNotification(params);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
