/**
 * Layer 2: where the scheduled run's message goes.
 *
 * - A run that needs a person (a PR or a failure) goes to the production channel
 *   (`SLACK_CHANNEL_ID`) with a mention on Cloud Run
 * - Other runs go to `SLACK_DEV_CHANNEL_ID`, or to `SLACK_CHANNEL_ID` without a mention when
 *   the dev channel is not set
 * - Never throws
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { ScheduledRunSummary } from '@/lib/scheduled/run';
import { notifyScheduledRun } from '@/lib/slack';

const originalFetch = global.fetch;

const ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_CHANNEL_ID: 'CPROD',
  SLACK_DEV_CHANNEL_ID: 'CDEV',
  SLACK_MENTION_USER_ID: 'U0000000001',
  CLOUD_RUN_JOB: 'revo-ai-writer-job',
} as NodeJS.ProcessEnv;

const summary = (outcome: 'pr' | 'skipped' | 'failure'): ScheduledRunSummary => ({
  dryRun: false,
  startedAt: new Date('2026-11-15T01:05:00Z'),
  finishedAt: new Date('2026-11-15T01:30:00Z'),
  items: [{ url: 'https://a.example/1', source: 'rss', outcome }],
  prCount: outcome === 'pr' ? 1 : 0,
  candidateCount: 1,
  feedErrors: [],
});

function mockFetchOk(): jest.Mock {
  const fn = jest.fn(async (_url: unknown, _init?: { body?: string }) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }));
  global.fetch = fn as unknown as typeof global.fetch;
  return fn as unknown as jest.Mock;
}

const sentBody = (fetchMock: jest.Mock) =>
  JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { channel: string; text: string };

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('notifyScheduledRun', () => {
  it.each(['pr', 'failure'] as const)('a run with a %s goes to production with a mention', async outcome => {
    const fetchMock = mockFetchOk();
    await notifyScheduledRun(summary(outcome), ENV);
    const body = sentBody(fetchMock);
    expect(body.channel).toBe('CPROD');
    expect(body.text.startsWith('<@U0000000001>')).toBe(true);
  });

  it('a quiet run goes to the dev channel without a mention', async () => {
    const fetchMock = mockFetchOk();
    await notifyScheduledRun(summary('skipped'), ENV);
    const body = sentBody(fetchMock);
    expect(body.channel).toBe('CDEV');
    expect(body.text).not.toContain('<@');
  });

  it('falls back to the production channel without a mention when the dev channel is not set', async () => {
    const fetchMock = mockFetchOk();
    await notifyScheduledRun(summary('skipped'), { ...ENV, SLACK_DEV_CHANNEL_ID: undefined });
    const body = sentBody(fetchMock);
    expect(body.channel).toBe('CPROD');
    expect(body.text).not.toContain('<@');
  });

  it('sends nothing and does not throw without a token', async () => {
    const fetchMock = mockFetchOk();
    await expect(notifyScheduledRun(summary('failure'), {} as NodeJS.ProcessEnv)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when sending fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof global.fetch;
    await expect(notifyScheduledRun(summary('failure'), ENV)).resolves.toBeUndefined();
  });
});
