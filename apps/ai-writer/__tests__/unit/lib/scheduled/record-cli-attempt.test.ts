/**
 * Layer 2: a `debug:mdx` run that makes a PR is recorded like a scheduled attempt.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import { recordCliAttempt } from '@/lib/scheduled/record-cli-attempt';
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

const NOW = new Date('2026-11-15T03:00:00Z');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('recordCliAttempt', () => {
  it('stores the normalized URL with source cli and the page date', async () => {
    const save = jest.fn(async (_: AttemptRecord) => true);
    await recordCliAttempt(
      () => ({ get: async () => undefined, save }),
      {
        url: 'https://a.example/1?utm_source=x',
        title: 't',
        pageHtml: '<meta property="article:published_time" content="2026-11-10T09:00:00+09:00">',
        result: { success: true, prResult: { prUrl: 'https://github.com/o/r/pull/2' } } as MdxGenerationResult,
        now: NOW,
      },
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      url: 'https://a.example/1',
      source: 'cli',
      status: 'done',
      prUrl: 'https://github.com/o/r/pull/2',
      publishedAtSource: 'meta',
    });
  });

  it('never throws when the store fails', async () => {
    const store = {
      get: async () => {
        throw new Error('PERMISSION_DENIED');
      },
      save: jest.fn(async () => true),
    };
    await expect(
      recordCliAttempt(() => store, { url: 'https://a.example/1', title: 't', pageHtml: '', result: { success: true } as MdxGenerationResult }),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
