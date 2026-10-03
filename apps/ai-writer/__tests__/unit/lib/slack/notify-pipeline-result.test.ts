/**
 * Layer 2: 入口から呼ぶ notifyPipelineResult の契約
 *
 * 固定したい性質:
 * - token / channel が無ければ fetch も Sentry も呼ばずに skip する
 *   (未設定は「失敗」ではない。拾うと記事生成のたびに Sentry の無料枠を溶かす)
 * - 例外を投げない。呼び出し元の catch 節から呼んでも、元のエラーが差し替わらない
 *   (旧 Incoming Webhook 実装で起きた事故。revolution PR #304)
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

import { notifyPipelineResult, type PipelineNotification } from '@/lib/slack';

const originalFetch = global.fetch;

const ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_CHANNEL_ID: 'C0000000001',
} as NodeJS.ProcessEnv;

const notification: PipelineNotification = {
  outcome: 'failure',
  entrypoint: 'cli',
  sourceUrl: 'https://example.com/article',
  error: 'boom',
};

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (Sentry.captureMessage as jest.Mock).mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOk(): jest.Mock {
  const fn = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  global.fetch = fn as unknown as typeof global.fetch;
  return fn as unknown as jest.Mock;
}

describe('notifyPipelineResult', () => {
  it('設定があれば chat.postMessage へ 1 回送る', async () => {
    const fetchMock = mockFetchOk();

    await notifyPipelineResult(notification, ENV);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('token が未設定なら fetch も Sentry も呼ばない', async () => {
    const fetchMock = mockFetchOk();

    await expect(
      notifyPipelineResult(notification, {} as NodeJS.ProcessEnv)
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('token が op:// の参照のままなら送らない', async () => {
    const fetchMock = mockFetchOk();

    await notifyPipelineResult(notification, {
      ...ENV,
      SLACK_BOT_TOKEN: 'op://Personal/slack/token',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 組み立て側で想定外の例外が出ても呼び出し元へ伝播させない (index.ts の try/catch の固定)
  it('メッセージの組み立てで例外が出ても throw せず、送信もしない', async () => {
    const fetchMock = mockFetchOk();
    const broken = { ...notification, sourceUrl: 123 as unknown as string };

    await expect(notifyPipelineResult(broken, ENV)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('送信が失敗しても throw しない', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof global.fetch;

    await expect(notifyPipelineResult(notification, ENV)).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 回帰テスト: 呼び出し元の catch 節で元のエラーが保持されること
//
// 入口 (CLI / cron route) は「エラーを受け取る → 通知する → 元のエラーで処理を続ける」
// 構造になる。通知側が throw すると、呼び出し側が受け取るエラーが差し替わり、
// 真因が特定できなくなる (2026-08-15 の実走で GITHUB_PAT 失効を踏んだ際に発生)。
// ────────────────────────────────────────────────────────────────────────────
describe('呼び出し元の catch 節で元エラーが保持されること (回帰)', () => {
  it.each([
    ['未設定', {} as NodeJS.ProcessEnv],
    ['送信失敗', ENV],
  ])('%s でも、再スローされるのは元のエラーである', async (_label, env) => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof global.fetch;

    const originalError = new Error('Branch already exists: ai-writer/mdx-collabo-cafe-xxx');
    const run = async (): Promise<never> => {
      try {
        throw originalError;
      } catch (error) {
        await notifyPipelineResult({ ...notification, error: String(error) }, env);
        throw error;
      }
    };

    await expect(run()).rejects.toThrow('Branch already exists: ai-writer/mdx-collabo-cafe-xxx');
  });
});
