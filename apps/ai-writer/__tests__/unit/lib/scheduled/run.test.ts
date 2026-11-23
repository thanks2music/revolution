/**
 * Layer 2: one scheduled run, with the store, the feeds, the page fetch and the pipeline faked.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { AttemptRecord } from '@/lib/scheduled/attempt-store';
import type { RssCandidateInput } from '@/lib/scheduled/candidates';
import type { RegisteredUrl } from '@/lib/scheduled/registered-url-store';
import { ALREADY_GIVEN_UP_REASON, runScheduled, type ScheduledRunDeps } from '@/lib/scheduled/run';
import { prCountOf } from '@/lib/scheduled/summary';
import type { MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';
import type { DetectedLink } from '@revolution/schemas/detected-link';
import { HttpStatusError } from '@/lib/utils/http-status-error';

const START = new Date('2026-11-15T01:05:00Z');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

const rssItems = (n: number): RssCandidateInput[] =>
  Array.from({ length: n }, (_, i) => ({
    link: `https://a.example/${i + 1}`,
    title: `記事 ${i + 1}`,
    // 1 is the newest
    pubDate: new Date(START.getTime() - (i + 1) * 60_000).toISOString(),
    feedId: 'feed-1',
  }));

const PR: MdxGenerationResult = {
  success: true,
  prResult: { prUrl: 'https://github.com/o/r/pull/1' } as MdxGenerationResult['prResult'],
};
const SKIP: MdxGenerationResult = { success: false, skipped: true, skipReason: '対象外' };
const FAIL: MdxGenerationResult = { success: false, error: '記事選別に失敗: API key not valid' };

function makeDeps(options: {
  items: RssCandidateInput[];
  results: (url: string) => MdxGenerationResult | Error;
  stored?: AttemptRecord[];
  registered?: RegisteredUrl[];
  detected?: DetectedLink[];
  clock?: () => Date;
}) {
  const saved = new Map<string, AttemptRecord>();
  for (const record of options.stored ?? []) saved.set(record.url, record);
  const generate = jest.fn(async (request: Parameters<ScheduledRunDeps['generate']>[0]) => {
    const value = options.results(request.rssItem.link);
    if (value instanceof Error) throw value;
    return value;
  });
  const save = jest.fn(async (record: AttemptRecord) => {
    saved.set(record.url, record);
    return true;
  });
  const marked: Array<{ urls: string[]; status: string }> = [];
  const deps: ScheduledRunDeps = {
    now: options.clock ?? (() => START),
    store: {
      findAttempted: async urls => new Set(urls.filter(url => saved.has(url))),
      findDueRetries: async now =>
        [...saved.values()].filter(r => r.nextAttemptAt && r.nextAttemptAt.getTime() <= now.getTime()),
      save,
    },
    loadRegisteredUrls: async () => options.registered ?? [],
    isRegistered: async url => (options.registered ?? []).some(entry => entry.url === url),
    loadDetectedLinks: async () => options.detected ?? [],
    markDetectedLinks: async (urls, status) => {
      marked.push({ urls, status });
    },
    loadRssItems: async () => ({ items: options.items, errors: [] }),
    fetchPage: async url => ({
      title: `title of ${url}`,
      html: '<p>本文</p>',
      actualUrl: url,
      pageHtml: '<meta property="article:published_time" content="2026-11-14T10:00:00+09:00">',
    }),
    generate,
  };
  return { deps, saved, save, generate, marked };
}

describe('runScheduled', () => {
  it('stops at 5 PRs', async () => {
    const { deps, generate } = makeDeps({ items: rssItems(8), results: () => PR });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(prCountOf(summary)).toBe(5);
    expect(summary.stopReason).toBe('max-prs');
    expect(generate).toHaveBeenCalledTimes(5);
  });

  it('stops after 15 tries, newest first, and saves every attempt', async () => {
    const { deps, generate, saved } = makeDeps({ items: rssItems(20), results: () => SKIP });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.items).toHaveLength(15);
    expect(summary.stopReason).toBe('max-tries');
    expect(generate.mock.calls[0][0].rssItem.link).toBe('https://a.example/1');
    expect(saved.size).toBe(15);
    expect(saved.get('https://a.example/1')).toMatchObject({ status: 'done', publishedAtSource: 'meta' });
  });

  it('a smaller try limit for a hand-checked dry run, never above 15', async () => {
    const small = makeDeps({ items: rssItems(20), results: () => SKIP });
    expect((await runScheduled(small.deps, { dryRun: true, maxTries: 3 })).items).toHaveLength(3);
    const large = makeDeps({ items: rssItems(20), results: () => SKIP });
    expect((await runScheduled(large.deps, { dryRun: true, maxTries: 99 })).items).toHaveLength(15);
  });

  it('does not start a new candidate after 90 minutes', async () => {
    let calls = 0;
    // each read of the clock moves 40 minutes on
    const clock = () => new Date(START.getTime() + calls++ * 40 * 60_000);
    const { deps, generate } = makeDeps({ items: rssItems(5), results: () => SKIP, clock });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBe('time-budget');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('a page the site refuses (403) is a skip: not retried, and not counted as a failure in a row', async () => {
    const { deps, saved } = makeDeps({ items: rssItems(4), results: () => SKIP });
    deps.fetchPage = async url => {
      throw new HttpStatusError(`記事データの取得に失敗: ${url} - HTTP error! status: 403 Forbidden`, 403);
    };
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBeUndefined();
    expect(summary.items.map(item => item.outcome)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
    expect(summary.items[0].reason).toContain('試し直しません');
    for (const record of saved.values()) {
      expect(record).toMatchObject({ status: 'done', nextAttemptAt: null });
    }
  });

  it('a page that names no work is a skip, not a failure to retry', async () => {
    const noWork = { success: false, skipped: true, skipKind: 'no-work-title', skipReason: '作品名なし' } as MdxGenerationResult;
    const { deps, saved } = makeDeps({ items: rssItems(3), results: () => noWork });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBeUndefined();
    expect(summary.items.map(item => item.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    for (const record of saved.values()) {
      expect(record).toMatchObject({ status: 'done', nextAttemptAt: null, failureCount: 0 });
    }
  });

  it('stops after 3 failures in a row and does not count them toward the retry limit', async () => {
    const { deps, saved } = makeDeps({ items: rssItems(6), results: () => FAIL });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBe('consecutive-failures');
    expect(summary.items).toHaveLength(3);
    for (const record of saved.values()) {
      expect(record).toMatchObject({ status: 'retrying-failure', failureCount: 0 });
    }
  });

  it('counts failures that are not part of a streak of 3', async () => {
    const results = (url: string) => (url.endsWith('/1') || url.endsWith('/2') ? FAIL : SKIP);
    const { deps, saved } = makeDeps({ items: rssItems(3), results });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBeUndefined();
    expect(saved.get('https://a.example/1')).toMatchObject({ status: 'retrying-failure', failureCount: 1 });
    expect(saved.get('https://a.example/2')).toMatchObject({ failureCount: 1 });
  });

  it('counts failures left at the end of the candidates', async () => {
    const { deps, saved } = makeDeps({ items: rssItems(2), results: () => new Error('HTTP 404') });
    await runScheduled(deps, { dryRun: false });
    expect(saved.get('https://a.example/1')).toMatchObject({ failureCount: 1, lastReason: 'HTTP 404' });
  });

  it('tries due retries before new items and skips URLs already tried', async () => {
    const waiting: AttemptRecord = {
      url: 'https://r.example/w',
      source: 'rss',
      status: 'waiting-details',
      lastOutcome: 'unannounced',
      attemptCount: 1,
      unannouncedCount: 1,
      failureCount: 0,
      firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
      lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
      nextAttemptAt: new Date('2026-11-08T00:00:00Z'),
      publishedAt: new Date('2026-10-31T00:00:00Z'),
      publishedAtSource: 'rss',
    };
    const done: AttemptRecord = { ...waiting, url: 'https://a.example/1', status: 'done', nextAttemptAt: null };
    const { deps, generate, saved } = makeDeps({ items: rssItems(2), results: () => SKIP, stored: [waiting, done] });
    await runScheduled(deps, { dryRun: false });
    expect(generate.mock.calls.map(call => call[0].rssItem.link)).toEqual(['https://r.example/w', 'https://a.example/2']);
    expect(saved.get('https://r.example/w')).toMatchObject({ attemptCount: 2, status: 'done' });
  });

  it('URLs that always fail are excused once, then counted and given up', async () => {
    const { deps, saved } = makeDeps({ items: rssItems(3), results: () => new Error('HTTP 403') });
    const run1 = await runScheduled(deps, { dryRun: false });
    expect(run1.stopReason).toBe('consecutive-failures');
    expect(saved.get('https://a.example/1')).toMatchObject({ failureCount: 0, status: 'retrying-failure' });
    await runScheduled(deps, { dryRun: false });
    expect(saved.get('https://a.example/1')).toMatchObject({ failureCount: 1 });
    await runScheduled(deps, { dryRun: false });
    await runScheduled(deps, { dryRun: false });
    expect(saved.get('https://a.example/1')).toMatchObject({ status: 'given-up', failureCount: 3 });
  });

  it('stops on a Firestore error and still returns what was done', async () => {
    const { deps } = makeDeps({ items: rssItems(3), results: () => PR });
    let saves = 0;
    deps.store.save = async () => {
      if (++saves === 2) throw new Error('UNAVAILABLE');
      return true;
    };
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.stopReason).toBe('error');
    expect(summary.error).toBe('UNAVAILABLE');
    expect(summary.items.map(item => item.prUrl)).toEqual(['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/1']);
  });

  it('stops with an error when the setup fails (reading the feeds)', async () => {
    const { deps, generate } = makeDeps({ items: rssItems(3), results: () => PR });
    deps.loadRssItems = async () => {
      throw new Error('rss_feeds: PERMISSION_DENIED');
    };
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary).toMatchObject({ stopReason: 'error', error: 'rss_feeds: PERMISSION_DENIED', items: [], candidateCount: 0 });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a skip that is really a step error is held and retried like a failure', async () => {
    const stepError: MdxGenerationResult = { success: false, skipped: true, skipKind: 'step-error', skipReason: 'コンテンツ生成に失敗: 503' };
    const { deps, saved } = makeDeps({ items: rssItems(1), results: () => stepError });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.items[0]).toMatchObject({ outcome: 'failure', reason: 'コンテンツ生成に失敗: 503' });
    expect(saved.get('https://a.example/1')).toMatchObject({ status: 'retrying-failure', failureCount: 1 });
  });

  it('writes nothing in a dry run and passes dryRun to the pipeline', async () => {
    const { deps, save, generate } = makeDeps({ items: rssItems(2), results: () => FAIL });
    const summary = await runScheduled(deps, { dryRun: true });
    expect(save).not.toHaveBeenCalled();
    expect(generate.mock.calls[0][0].dryRun).toBe(true);
    expect(summary.items.map(item => item.outcome)).toEqual(['failure', 'failure']);
  });

  it('limits RSS candidates to the writing scope, and keeps an out-of-scope skip as done with its kind', async () => {
    const outOfScope: MdxGenerationResult = {
      success: false,
      skipped: true,
      skipKind: 'out-of-scope',
      skipReason: '書く対象の外 (種別 pop-up-store / 運営 LTR)',
    };
    const { deps, generate, saved } = makeDeps({ items: rssItems(1), results: () => outOfScope });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(generate.mock.calls[0][0].applyWritingScope).toBe(true);
    expect(summary.items[0]).toMatchObject({ outcome: 'skipped', reason: '書く対象の外 (種別 pop-up-store / 運営 LTR)' });
    expect(saved.get('https://a.example/1')).toMatchObject({
      status: 'done',
      nextAttemptAt: null,
      lastSkipKind: 'out-of-scope',
      lastReason: '書く対象の外 (種別 pop-up-store / 運営 LTR)',
    });
  });

  it.each([
    ['rss', true],
    ['registered', false],
    ['cli', false],
  ] as const)('a retry whose first attempt came from %s: writing scope %s', async (source, applied) => {
    const waiting: AttemptRecord = {
      url: 'https://r.example/w',
      source,
      status: 'waiting-details',
      lastOutcome: 'unannounced',
      attemptCount: 1,
      unannouncedCount: 1,
      failureCount: 0,
      firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
      lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
      nextAttemptAt: new Date('2026-11-08T00:00:00Z'),
      publishedAt: new Date('2026-10-31T00:00:00Z'),
      publishedAtSource: 'rss',
    };
    const { deps, generate } = makeDeps({ items: [], results: () => SKIP, stored: [waiting] });
    await runScheduled(deps, { dryRun: false });
    expect(generate.mock.calls[0][0].applyWritingScope).toBe(applied);
  });

  it('reports what each URL ended in', async () => {
    const unannounced: MdxGenerationResult = {
      success: false,
      skipped: true,
      skipKind: 'unannounced-event',
      skipReason: '詳細未発表のためスキップ',
    };
    const { deps } = makeDeps({ items: rssItems(1), results: () => unannounced });
    const summary = await runScheduled(deps, { dryRun: false });
    expect(summary.items[0]).toMatchObject({
      outcome: 'unannounced',
      reason: '詳細未発表のためスキップ',
      title: '記事 1',
      // published 2026-11-14, first tried 2026-11-15: a fresh page, so a week later
      nextAttemptAt: new Date('2026-11-22T01:05:00Z'),
    });
  });

  describe('registered URLs', () => {
    const registered = (url: string, createdAt: string): RegisteredUrl => ({
      id: `id-${url}`,
      url,
      createdBy: 'boss@example.com',
      createdAt: new Date(createdAt),
    });

    it('tries untried registered URLs first, the oldest registration first', async () => {
      const { deps, generate } = makeDeps({
        items: rssItems(1),
        results: () => SKIP,
        registered: [registered('https://reg.example/new', '2026-11-14T00:00:00Z'), registered('https://reg.example/old', '2026-11-10T00:00:00Z')],
      });
      const summary = await runScheduled(deps, { dryRun: false });
      expect(generate.mock.calls.map(call => call[0].rssItem.link)).toEqual([
        'https://reg.example/old',
        'https://reg.example/new',
        'https://a.example/1',
      ]);
      expect(summary.items.map(item => item.registered)).toEqual([true, true, false]);
      // a person chose the registered URLs, so only the RSS item is limited to the writing scope
      expect(generate.mock.calls.map(call => call[0].applyWritingScope)).toEqual([false, false, true]);
    });

    it('lets article selection take a registered page itself as the official page, but not an RSS item', async () => {
      const { deps, generate } = makeDeps({
        items: rssItems(1),
        results: () => SKIP,
        registered: [registered('https://reg.example/official', '2026-11-10T00:00:00Z')],
      });
      await runScheduled(deps, { dryRun: false });
      expect(generate.mock.calls.map(call => [call[0].rssItem.link, call[0].inputMayBeOfficialPage])).toEqual([
        ['https://reg.example/official', true],
        ['https://a.example/1', false],
      ]);
    });

    it('does not try a registered URL again once it has a record', async () => {
      const { deps, generate } = makeDeps({
        items: [],
        results: () => SKIP,
        registered: [registered('https://reg.example/1', '2026-11-10T00:00:00Z')],
      });
      await runScheduled(deps, { dryRun: false });
      await runScheduled(deps, { dryRun: false });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('records the source, the page title, and the registration date when the page shows none', async () => {
      const { deps, saved } = makeDeps({
        items: [],
        results: () => SKIP,
        registered: [registered('https://reg.example/1', '2026-11-10T00:00:00Z')],
      });
      deps.fetchPage = async url => ({ title: 'イベントのページ', html: '<p>本文</p>', actualUrl: url, pageHtml: '<p>no date</p>' });
      const summary = await runScheduled(deps, { dryRun: false });
      expect(saved.get('https://reg.example/1')).toMatchObject({
        source: 'registered',
        title: 'イベントのページ',
        publishedAt: new Date('2026-11-10T00:00:00Z'),
        publishedAtSource: 'registration',
      });
      expect(summary.items[0]).toMatchObject({ registered: true, title: 'イベントのページ' });
    });

    it('marks a retry of a registered URL as registered', async () => {
      const waiting: AttemptRecord = {
        url: 'https://reg.example/1',
        source: 'registered',
        status: 'waiting-details',
        lastOutcome: 'unannounced',
        attemptCount: 1,
        unannouncedCount: 1,
        failureCount: 0,
        firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
        lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
        nextAttemptAt: new Date('2026-11-08T00:00:00Z'),
        publishedAt: new Date('2026-10-31T00:00:00Z'),
        publishedAtSource: 'registration',
      };
      const { deps } = makeDeps({
        items: [],
        results: () => SKIP,
        stored: [waiting],
        registered: [registered('https://reg.example/1', '2026-10-31T00:00:00Z')],
      });
      const summary = await runScheduled(deps, { dryRun: false });
      expect(summary.items).toEqual([expect.objectContaining({ url: 'https://reg.example/1', registered: true })]);
    });

    it('keeps the run going when the registrations cannot be read', async () => {
      const { deps, generate } = makeDeps({ items: rssItems(1), results: () => SKIP });
      deps.loadRegisteredUrls = async () => {
        throw new Error('UNAVAILABLE');
      };
      const summary = await runScheduled(deps, { dryRun: false });
      expect(summary.stopReason).toBeUndefined();
      expect(summary.feedErrors).toEqual(['登録 URL: UNAVAILABLE']);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('does not show a retry for a URL whose record the store kept as given up', async () => {
      const unannounced: MdxGenerationResult = { success: false, skipped: true, skipKind: 'unannounced-event', skipReason: '詳細未発表' };
      const { deps } = makeDeps({
        items: [],
        results: () => unannounced,
        registered: [registered('https://reg.example/1', '2026-11-10T00:00:00Z')],
      });
      deps.store.save = async () => false;
      const summary = await runScheduled(deps, { dryRun: false });
      expect(summary.items[0]).toMatchObject({ nextAttemptAt: null, givenUpReason: ALREADY_GIVEN_UP_REASON });
    });

    it('gives up instead of queuing a retry when the registration was removed before the first save', async () => {
      const unannounced: MdxGenerationResult = { success: false, skipped: true, skipKind: 'unannounced-event', skipReason: '詳細未発表' };
      const { deps, saved } = makeDeps({
        items: [],
        results: () => unannounced,
        registered: [registered('https://reg.example/1', '2026-11-10T00:00:00Z')],
      });
      // removed while the run was trying it
      deps.isRegistered = async () => false;
      const summary = await runScheduled(deps, { dryRun: false });
      expect(saved.get('https://reg.example/1')).toMatchObject({
        status: 'given-up',
        nextAttemptAt: null,
        givenUpReason: '登録を取り消したため打ち切りました',
      });
      expect(summary.items[0]).toMatchObject({ nextAttemptAt: null, givenUpReason: '登録を取り消したため打ち切りました' });
    });

    it('queues a retry for a registered URL that is still registered', async () => {
      const unannounced: MdxGenerationResult = { success: false, skipped: true, skipKind: 'unannounced-event', skipReason: '詳細未発表' };
      const { deps, saved } = makeDeps({
        items: [],
        results: () => unannounced,
        registered: [registered('https://reg.example/1', '2026-11-10T00:00:00Z')],
      });
      await runScheduled(deps, { dryRun: false });
      expect(saved.get('https://reg.example/1')).toMatchObject({ status: 'waiting-details' });
    });
  });

  describe('detected links (WEB checker)', () => {
    const link = (url: string, ageDays: number): DetectedLink => ({
      url,
      targetId: 'target-1',
      targetTitle: 'サンプル公式サイト',
      detectedAt: START.getTime() - ageDays * 24 * 60 * 60 * 1000,
      status: 'pending',
    });

    it('tries a detected link without the writing scope, as a possible official page, and marks it tried', async () => {
      const { deps, generate, saved, marked } = makeDeps({
        items: [],
        detected: [link('https://det.example/1', 1)],
        results: () => PR,
      });
      const summary = await runScheduled(deps, { dryRun: false });
      expect(generate.mock.calls[0][0].applyWritingScope).toBe(false);
      expect(generate.mock.calls[0][0].inputMayBeOfficialPage).toBe(true);
      expect(saved.get('https://det.example/1')?.source).toBe('detected');
      expect(summary.items[0].detected).toBe(true);
      expect(marked).toContainEqual({ urls: ['https://det.example/1'], status: 'tried' });
    });

    it('marks links past 30 days expired, and links already tried another way tried, without trying them', async () => {
      const { deps, generate, marked } = makeDeps({
        items: [],
        detected: [link('https://det.example/old', 31), link('https://det.example/done', 1)],
        stored: [
          {
            url: 'https://det.example/done',
            source: 'rss',
            status: 'done',
            lastOutcome: 'skip',
            attemptCount: 1,
            unannouncedCount: 0,
            failureCount: 0,
            firstAttemptAt: new Date('2026-11-01T00:00:00Z'),
            lastAttemptAt: new Date('2026-11-01T00:00:00Z'),
            nextAttemptAt: null,
            publishedAt: new Date('2026-10-31T00:00:00Z'),
            publishedAtSource: 'rss',
          },
        ],
        results: () => PR,
      });
      await runScheduled(deps, { dryRun: false });
      expect(generate).not.toHaveBeenCalled();
      expect(marked).toContainEqual({ urls: ['https://det.example/old'], status: 'expired' });
      expect(marked).toContainEqual({ urls: ['https://det.example/done'], status: 'tried' });
    });

    it('writes nothing in a dry run', async () => {
      const { deps, generate, marked } = makeDeps({
        items: [],
        detected: [link('https://det.example/1', 1), link('https://det.example/old', 31)],
        results: () => PR,
      });
      await runScheduled(deps, { dryRun: true });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(marked).toEqual([]);
    });

    it('leaves a link pending when its attempt record could not be stored', async () => {
      const { deps, save, marked } = makeDeps({ items: [], detected: [link('https://det.example/1', 1)], results: () => PR });
      save.mockRejectedValueOnce(new Error('Firestore unavailable'));
      const summary = await runScheduled(deps, { dryRun: false });
      expect(summary.stopReason).toBe('error');
      expect(marked).toEqual([]);
    });

    it('reports a failure to read detected links without stopping the run', async () => {
      const { deps, generate } = makeDeps({ items: rssItems(1), results: () => PR });
      deps.loadDetectedLinks = async () => {
        throw new Error('permission denied');
      };
      const summary = await runScheduled(deps, { dryRun: false });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(summary.feedErrors).toContainEqual(expect.stringContaining('検知リンク: permission denied'));
    });
  });
});
