import { describe, expect, it, jest } from '@jest/globals';

import {
  generateWithArchiveFallback,
  planArchiveRun,
  rssItemFromPage,
  type ArchiveRunPlan,
  type PlanArchiveRunDeps,
} from '@/lib/archive-source/plan-run';
import type { MdxGenerationRequest, MdxGenerationResult } from '@/lib/services/article-generation-mdx.service';

import { ARTICLE_HTML, ARTICLE_URL, SOURCE } from './fixtures';

const post = {
  link: ARTICLE_URL,
  title: { rendered: 'サンプル作品カフェ' },
  content: { rendered: ARTICLE_HTML },
  starts_at: '2019-01-22 10:00:00',
  ends_at: '2019-02-03 20:00:00',
  event_types: [10],
  _embedded: { 'wp:featuredmedia': [{ source_url: 'https://archive.example.com/wp-content/uploads/kv.jpg' }] },
};

function deps(overrides: Partial<PlanArchiveRunDeps> = {}): PlanArchiveRunDeps {
  return {
    sources: [SOURCE],
    fetchJson: async () => [post],
    fetchContent: async () => ({ compacted: '<p>サンプル作品 cafe</p>', raw: '<p>サンプル作品 cafe</p>' }),
    extractWork: async () => ({
      workTitle: 'サンプル作品',
      storeName: 'カフェ',
      eventTypeName: 'コラボカフェ',
      model: 'test',
      confidence: 1,
    }),
    ...overrides,
  };
}

describe('planArchiveRun', () => {
  it('returns null for URLs that are not archive articles, without fetching', async () => {
    const fetchJson = jest.fn(async () => [post]);
    expect(await planArchiveRun('https://official.example.com/event/', deps({ fetchJson }))).toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('reads images from the archive site when the URL is given with "www."', async () => {
    const wwwUrl = ARTICLE_URL.replace('://', '://www.');
    const sources = [{ ...SOURCE, hosts: [...SOURCE.hosts, new URL(wwwUrl).hostname] }];
    const plan = await planArchiveRun(wwwUrl, deps({ sources }));
    if (plan?.mode !== 'official') throw new Error('expected the official mode');
    // Same images as with the archive's own URL (relative and absolute ones alike)
    const canonical = await planArchiveRun(ARTICLE_URL, deps());
    if (canonical?.mode !== 'official') throw new Error('expected the official mode');
    expect(plan.fallback.sourceOverride.categoryImages.all).toEqual(canonical.fallback.sourceOverride.categoryImages.all);
    expect(plan.fallback.sourceOverride.categoryImages.menu).toHaveLength(2);
  });

  it('builds from the official site when it is alive', async () => {
    const plan = await planArchiveRun(ARTICLE_URL, deps());
    expect(plan).toEqual(
      expect.objectContaining({ mode: 'official', inputUrl: 'https://official.example.com/event/', eventYear: 2019 }),
    );
    // Ready in case the official site no longer lists the items
    if (plan?.mode !== 'official') throw new Error('expected the official mode');
    expect(plan.fallback).toEqual(
      expect.objectContaining({ mode: 'archive', inputUrl: ARTICLE_URL, reason: 'official-has-no-items' }),
    );
    // The site is alive, so the rebuilt article may still link to it
    expect(plan.fallback.sourceOverride.unlinkScope).toBe('none');
    expect(plan.fallback.sourceOverride.categoryImages.menu).toHaveLength(2);
  });

  it('builds from the archive article when the official site is gone', async () => {
    const plan = await planArchiveRun(
      ARTICLE_URL,
      deps({
        fetchContent: async () => {
          throw new Error('コンテンツHTMLの取得に失敗: https://official.example.com/event/ - fetch failed');
        },
      }),
    );
    if (plan?.mode !== 'archive') throw new Error(`expected the archive mode, got ${plan?.mode}`);
    expect(plan.inputUrl).toBe(ARTICLE_URL);
    expect(plan.eventYear).toBe(2019);
    expect(plan.reason).toBe('unreachable');
    expect(plan.extracted).toEqual({ workTitle: 'サンプル作品', storeName: 'カフェ', eventTypeName: 'コラボカフェ' });
    expect(plan.sourceOverride).toEqual(
      expect.objectContaining({
        officialUrl: 'https://official.example.com/event/',
        ogImage: 'https://archive.example.com/wp-content/uploads/kv.jpg',
        reason: 'unreachable',
        // The site cannot be reached at all, so no link to any of its pages
        unlinkScope: 'host',
      }),
    );
    expect(plan.sourceOverride.categoryImages.menu).toHaveLength(2);
  });

  it('builds from the archive article when the official URL now shows another event', async () => {
    const plan = await planArchiveRun(
      ARTICLE_URL,
      deps({ fetchContent: async () => ({ compacted: '<p>別の作品</p>', raw: '<p>別の作品</p>' }) }),
    );
    expect(plan).toEqual(expect.objectContaining({ mode: 'archive', reason: 'title-mismatch' }));
  });

  it('throws when the article has no official site URL', async () => {
    const noLink = { ...post, content: { rendered: '<h2>メニュー</h2><p>no links</p>' } };
    await expect(planArchiveRun(ARTICLE_URL, deps({ fetchJson: async () => [noLink] }))).rejects.toThrow(
      'no official site URL',
    );
  });
});

describe('rssItemFromPage', () => {
  it('builds the pipeline input from a page', () => {
    const html = 'x'.repeat(600);
    expect(rssItemFromPage({ title: 'T', html, actualUrl: 'https://a.example/' }, '2000-01-01T00:00:00.000Z')).toEqual({
      title: 'T',
      link: 'https://a.example/',
      content: html,
      contentSnippet: 'x'.repeat(500),
      pubDate: '2000-01-01T00:00:00.000Z',
    });
  });
});

describe('generateWithArchiveFallback', () => {
  const request: MdxGenerationRequest = {
    rssItem: { title: 'Official', link: 'https://official.example.com/event/', content: '<p></p>', pubDate: '2000-01-01T00:00:00.000Z' },
    dryRun: true,
    eventYear: 2019,
  };
  const readPage = jest.fn(async (url: string) => ({ title: 'Archive', html: '<p>archive</p>', actualUrl: url }));
  const unannounced: MdxGenerationResult = { success: false, skipped: true, skipKind: 'unannounced-event', skipReason: 'no items' };

  async function officialPlan(): Promise<ArchiveRunPlan> {
    const plan = await planArchiveRun(ARTICLE_URL, deps());
    if (!plan) throw new Error('expected a plan');
    return plan;
  }

  it('returns the first result unless an official-site run stopped as unannounced', async () => {
    const done: MdxGenerationResult = { success: true };
    const generate = jest.fn(async () => done);
    expect(await generateWithArchiveFallback(await officialPlan(), request, generate, readPage)).toBe(done);
    expect(generate).toHaveBeenCalledTimes(1);

    const skip = jest.fn(async () => unannounced);
    expect(await generateWithArchiveFallback(null, request, skip, readPage)).toBe(unannounced);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it('builds again from the archive article, keeping the event year and the run time', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await officialPlan();
    const generate = jest
      .fn<(r: MdxGenerationRequest) => Promise<MdxGenerationResult>>()
      .mockResolvedValueOnce(unannounced)
      .mockResolvedValueOnce({ success: true });

    await generateWithArchiveFallback(plan, request, generate, readPage);

    expect(readPage).toHaveBeenCalledWith(ARTICLE_URL);
    const second = generate.mock.calls[1][0];
    expect(second.rssItem).toEqual(expect.objectContaining({ title: 'Archive', link: ARTICLE_URL, pubDate: request.rssItem.pubDate }));
    expect(second.eventYear).toBe(2019);
    expect(second.sourceOverride?.unlinkScope).toBe('none');
    expect(second.extracted?.workTitle).toBe('サンプル作品');
  });

  it('keeps the skip when the archive article cannot be read again', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const generate = jest.fn(async () => unannounced);
    const failingRead = jest.fn(async (): Promise<{ title: string; html: string; actualUrl: string }> => {
      throw new Error('fetch failed');
    });

    expect(await generateWithArchiveFallback(await officialPlan(), request, generate, failingRead)).toBe(unannounced);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
