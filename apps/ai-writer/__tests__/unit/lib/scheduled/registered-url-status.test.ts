/**
 * Layer 1: how the admin UI shows what happened to a registered URL.
 */
import { describe, expect, it } from '@jest/globals';

import { describeRegisteredUrlStatus } from '@/lib/scheduled/registered-url-status';
import type { RegisteredUrlAttemptView } from '@/lib/types/registered-url';

const base: RegisteredUrlAttemptView = {
  status: 'done',
  lastOutcome: 'skipped',
  attemptCount: 1,
  // 2026-11-15 in Japan
  lastAttemptAt: '2026-11-14T16:00:00.000Z',
  nextAttemptAt: null,
};

describe('describeRegisteredUrlStatus', () => {
  it('a URL not tried yet', () => {
    expect(describeRegisteredUrlStatus(undefined)).toEqual({
      label: '未試行',
      tone: 'pending',
      details: ['次の定期実行で試します'],
    });
  });

  it('a PR, with its link', () => {
    expect(describeRegisteredUrlStatus({ ...base, lastOutcome: 'pr', prUrl: 'https://github.com/o/r/pull/9' })).toEqual({
      label: 'PR 作成',
      tone: 'success',
      details: ['最後に試した日: 2026-11-15 (1 回目)'],
      prUrl: 'https://github.com/o/r/pull/9',
    });
  });

  it('a skip, with its reason', () => {
    expect(describeRegisteredUrlStatus({ ...base, lastReason: '既に記事があります' })).toMatchObject({
      label: 'スキップ',
      details: ['理由: 既に記事があります', '最後に試した日: 2026-11-15 (1 回目)'],
    });
  });

  it('waiting for details, with the next day in Japan', () => {
    const view = describeRegisteredUrlStatus({
      ...base,
      status: 'waiting-details',
      lastOutcome: 'unannounced',
      nextAttemptAt: '2026-11-21T16:00:00.000Z',
    });
    expect(view).toMatchObject({ label: '詳細未発表', tone: 'waiting' });
    expect(view.details[0]).toBe('次に試す日: 2026-11-22');
  });

  it('a failure waiting for the next run', () => {
    expect(
      describeRegisteredUrlStatus({ ...base, status: 'retrying-failure', lastOutcome: 'failure', lastReason: 'HTTP 503' }),
    ).toMatchObject({ label: '失敗 (試し直し待ち)', tone: 'error', details: ['理由: HTTP 503', '次の定期実行で試し直します', expect.any(String)] });
  });

  it('given up, with why', () => {
    expect(
      describeRegisteredUrlStatus({ ...base, status: 'given-up', lastOutcome: 'unannounced', givenUpReason: '登録を取り消したため打ち切りました' }),
    ).toMatchObject({ label: '打ち切り', details: ['登録を取り消したため打ち切りました', expect.any(String)] });
  });
});
