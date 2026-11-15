/**
 * Layer 1: the record stored after one attempt.
 */
import { describe, expect, it } from '@jest/globals';

import { buildAttemptRecord, describeAttempt, toAttemptOutcome } from '@/lib/scheduled/attempt-record';
import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

const NOW = new Date('2026-11-15T03:00:00Z');
const URL = 'https://a.example/1';

const pipeline = (result: Partial<MdxGenerationResult>) => ({
  kind: 'pipeline' as const,
  result: { success: false, ...result } as MdxGenerationResult,
});

describe('toAttemptOutcome', () => {
  it('checks skipped before success (a skip is success: false)', () => {
    expect(toAttemptOutcome(pipeline({ skipped: true, skipReason: '対象外' }), true)).toEqual({ kind: 'skipped' });
  });
  it('reads the unannounced skip and its start date', () => {
    expect(
      toAttemptOutcome(pipeline({ skipped: true, skipKind: 'unannounced-event', eventStartDate: '2026-12-01' }), true),
    ).toEqual({ kind: 'unannounced', eventStartDate: '2026-12-01' });
  });
  it('a skip that is really a step error (detail extraction, content generation) is a failure', () => {
    expect(toAttemptOutcome(pipeline({ skipped: true, skipKind: 'step-error', skipReason: 'コンテンツ生成に失敗: 503' }), true)).toEqual({
      kind: 'failure',
      counted: true,
    });
  });
  it('treats an existing event as an ordinary skip', () => {
    expect(toAttemptOutcome(pipeline({ skipped: true, skipKind: 'existing-event' }), true)).toEqual({ kind: 'skipped' });
  });
  it('a failure result and a thrown error are failures', () => {
    expect(toAttemptOutcome(pipeline({ error: 'x' }), true)).toEqual({ kind: 'failure', counted: true });
    expect(toAttemptOutcome({ kind: 'error', error: 'HTTP 404' }, false)).toEqual({ kind: 'failure', counted: false });
  });
  it('success is a PR', () => {
    expect(toAttemptOutcome(pipeline({ success: true }), true)).toEqual({ kind: 'pr' });
  });
  it.each([401, 403, 410, 451])('a page refused or gone (HTTP %i) is a skip, not retried', status => {
    expect(toAttemptOutcome({ kind: 'error', error: 'HTTP', httpStatus: status }, true)).toEqual({ kind: 'skipped' });
  });
  it.each([404, 429, 500, 503])('a passing error status (HTTP %i) stays a failure', status => {
    expect(toAttemptOutcome({ kind: 'error', error: 'HTTP', httpStatus: status }, true)).toEqual({
      kind: 'failure',
      counted: true,
    });
  });
  it('no work title on the official page is a skip (trying again gives the same page)', () => {
    expect(toAttemptOutcome(pipeline({ skipped: true, skipKind: 'no-work-title' }), true)).toEqual({ kind: 'skipped' });
  });
});

describe('describeAttempt', () => {
  it('says why a refused page is not tried again', () => {
    const { reason } = describeAttempt({
      kind: 'error',
      error: '記事データの取得に失敗: https://a.example/1 - HTTP error! status: 403 Forbidden',
      httpStatus: 403,
    });
    expect(reason).toContain('403 Forbidden');
    expect(reason).toContain('試し直しません');
  });
  it('keeps the error of a passing failure as it is', () => {
    expect(describeAttempt({ kind: 'error', error: 'HTTP error! status: 503', httpStatus: 503 })).toEqual({
      reason: 'HTTP error! status: 503',
    });
  });
});

describe('buildAttemptRecord', () => {
  it('the first attempt uses the page date and records the PR', () => {
    const record = buildAttemptRecord(
      undefined,
      {
        url: URL,
        source: 'rss',
        feedId: 'feed-1',
        title: 't',
        pageDate: { date: new Date('2026-11-10T00:00:00Z'), source: 'meta' },
        rssPubDate: new Date('2026-11-14T00:00:00Z'),
        now: NOW,
      },
      pipeline({
        success: true,
        prResult: { prUrl: 'https://github.com/o/r/pull/1' } as MdxGenerationResult['prResult'],
        details: { postId: 'p1' } as MdxGenerationResult['details'],
      }),
      true,
    );
    expect(record).toMatchObject({
      url: URL,
      source: 'rss',
      status: 'done',
      lastOutcome: 'pr',
      prUrl: 'https://github.com/o/r/pull/1',
      postId: 'p1',
      attemptCount: 1,
      firstAttemptAt: NOW,
      lastAttemptAt: NOW,
      nextAttemptAt: null,
      publishedAt: new Date('2026-11-10T00:00:00Z'),
      publishedAtSource: 'meta',
    });
  });

  it('falls back to the RSS date, then to the first attempt', () => {
    const base = { url: URL, source: 'rss' as const, now: NOW };
    const skip = pipeline({ skipped: true, skipReason: 'x' });
    expect(buildAttemptRecord(undefined, { ...base, rssPubDate: new Date('2026-11-14T00:00:00Z') }, skip, true)).toMatchObject({
      publishedAtSource: 'rss',
    });
    expect(buildAttemptRecord(undefined, base, skip, true)).toMatchObject({ publishedAt: NOW, publishedAtSource: 'first-attempt' });
  });

  it('a retry keeps the first attempt, the source and the publish date, and counts up', () => {
    const previous: AttemptRecord = {
      url: URL,
      source: 'cli',
      status: 'waiting-details',
      lastOutcome: 'unannounced',
      attemptCount: 1,
      unannouncedCount: 1,
      failureCount: 0,
      firstAttemptAt: new Date('2026-11-01T03:00:00Z'),
      lastAttemptAt: new Date('2026-11-01T03:00:00Z'),
      nextAttemptAt: new Date('2026-11-08T03:00:00Z'),
      publishedAt: new Date('2026-10-30T00:00:00Z'),
      publishedAtSource: 'json-ld',
    };
    const record = buildAttemptRecord(
      previous,
      { url: URL, source: 'rss', pageDate: { date: new Date('2026-11-12T00:00:00Z'), source: 'meta' }, now: NOW },
      pipeline({ skipped: true, skipKind: 'unannounced-event', skipReason: '詳細未発表' }),
      true,
    );
    expect(record).toMatchObject({
      source: 'cli',
      attemptCount: 2,
      unannouncedCount: 2,
      firstAttemptAt: previous.firstAttemptAt,
      publishedAt: previous.publishedAt,
      publishedAtSource: 'json-ld',
      status: 'waiting-details',
      lastReason: '詳細未発表',
      nextAttemptAt: new Date('2026-11-18T03:00:00Z'),
    });
  });

  it('keeps the error of a thrown attempt as the reason', () => {
    const record = buildAttemptRecord(undefined, { url: URL, source: 'rss', now: NOW }, { kind: 'error', error: 'HTTP 404' }, true);
    expect(record).toMatchObject({ status: 'retrying-failure', lastOutcome: 'failure', lastReason: 'HTTP 404', failureCount: 1 });
  });
});
