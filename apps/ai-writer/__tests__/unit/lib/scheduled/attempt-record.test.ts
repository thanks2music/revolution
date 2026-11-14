/**
 * Layer 1: the record stored after one attempt.
 */
import { describe, expect, it } from '@jest/globals';

import { buildAttemptRecord, toAttemptOutcome } from '@/lib/scheduled/attempt-record';
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
        countFailure: true,
      },
      pipeline({
        success: true,
        prResult: { prUrl: 'https://github.com/o/r/pull/1' } as MdxGenerationResult['prResult'],
        details: { postId: 'p1' } as MdxGenerationResult['details'],
      }),
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
    const base = { url: URL, source: 'rss' as const, now: NOW, countFailure: true };
    const skip = pipeline({ skipped: true, skipReason: 'x' });
    expect(buildAttemptRecord(undefined, { ...base, rssPubDate: new Date('2026-11-14T00:00:00Z') }, skip)).toMatchObject({
      publishedAtSource: 'rss',
    });
    expect(buildAttemptRecord(undefined, base, skip)).toMatchObject({ publishedAt: NOW, publishedAtSource: 'first-attempt' });
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
      { url: URL, source: 'rss', pageDate: { date: new Date('2026-11-12T00:00:00Z'), source: 'meta' }, now: NOW, countFailure: true },
      pipeline({ skipped: true, skipKind: 'unannounced-event', skipReason: '詳細未発表' }),
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
    const record = buildAttemptRecord(undefined, { url: URL, source: 'rss', now: NOW, countFailure: true }, { kind: 'error', error: 'HTTP 404' });
    expect(record).toMatchObject({ status: 'retrying-failure', lastOutcome: 'failure', lastReason: 'HTTP 404', failureCount: 1 });
  });
});
