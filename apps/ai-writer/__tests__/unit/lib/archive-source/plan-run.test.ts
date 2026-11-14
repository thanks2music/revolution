import { describe, expect, it, jest } from '@jest/globals';

import { planArchiveRun, type PlanArchiveRunDeps } from '@/lib/archive-source/plan-run';

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
