/**
 * Layer 1: `beforeSendFilter` / `flushSentry` の純粋ロジック。
 *
 * `beforeSendFilter` は Sentry へ送るイベントの選別そのもので、ここが壊れると
 * (a) 無料枠 5K events/月 を想定内のエラーで溶かす、または
 * (b) 対応すべきエラーが静かに drop される、のどちらかが起きる。
 * どちらも「気づけない」種類の障害なので契約として固定する。
 */
import type { ErrorEvent, EventHint } from '@sentry/nextjs';
import * as Sentry from '@sentry/nextjs';

import {
  BranchConflictError,
  DuplicateSlugError,
  GitHubAuthError,
  GitHubRateLimitError,
} from '@/lib/errors/github';
import { beforeSendFilter, flushSentry } from '@/lib/observability/sentry';

/** 最小限の ErrorEvent。level 以外は filter の判定に使われない。 */
function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { event_id: 'abc123', level: 'error', ...overrides } as ErrorEvent;
}

function makeHint(originalException: unknown): EventHint {
  return { originalException } as EventHint;
}

describe('beforeSendFilter', () => {
  it('DuplicateSlugError は drop する (null を返す)', () => {
    const error = new DuplicateSlugError('既に生成済み', 'my-slug', 'content/a.mdx');

    expect(beforeSendFilter(makeEvent(), makeHint(error))).toBeNull();
  });

  it('retryable な GitHub エラーは warning へ降格する', () => {
    // GitHubRateLimitError.retryable === true
    const event = beforeSendFilter(makeEvent(), makeHint(new GitHubRateLimitError('rate limited')));

    expect(event).not.toBeNull();
    expect(event?.level).toBe('warning');
  });

  it('retryable なら種類を問わず降格する (BranchConflictError)', () => {
    const event = beforeSendFilter(makeEvent(), makeHint(new BranchConflictError('conflict', 'br')));

    expect(event?.level).toBe('warning');
  });

  it('retryable でない GitHub エラーは error のまま素通しする', () => {
    // GitHubAuthError.retryable === false → 誰かが起きて対応すべきもの
    const event = beforeSendFilter(makeEvent(), makeHint(new GitHubAuthError('bad token')));

    expect(event?.level).toBe('error');
  });

  it('GitHub 以外の未知のエラーは素通しする', () => {
    const original = makeEvent();
    const event = beforeSendFilter(original, makeHint(new Error('boom')));

    expect(event).not.toBeNull();
    expect(event?.level).toBe('error');
  });

  it('originalException が無い hint でも落ちない', () => {
    expect(beforeSendFilter(makeEvent(), {} as EventHint)).not.toBeNull();
  });

  it('降格時に元イベントを破壊しない (新しいオブジェクトを返す)', () => {
    const original = makeEvent();
    const event = beforeSendFilter(original, makeHint(new GitHubRateLimitError('rate limited')));

    expect(original.level).toBe('error');
    expect(event).not.toBe(original);
  });
});

describe('flushSentry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('指定した timeout で Sentry.flush を呼ぶ', async () => {
    await flushSentry(1234);

    expect(Sentry.flush).toHaveBeenCalledWith(1234);
  });

  it('既定の timeout は 2000ms', async () => {
    await flushSentry();

    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  // 監視の失敗で業務処理を落とさないことの担保
  it('flush が reject しても throw しない', async () => {
    (Sentry.flush as jest.Mock).mockRejectedValueOnce(new Error('network down'));

    await expect(flushSentry()).resolves.toBeUndefined();
  });
});
