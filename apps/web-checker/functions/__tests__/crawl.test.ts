import { describe, expect, it } from '@jest/globals';
import type { SlackMessage } from '@revolution/slack/post-message';

import { crawlTarget, type CrawlDeps, type TargetStore } from '../src/crawl';
import type { Snapshot, Target } from '../src/targets';

const target: Target = {
  url: 'https://example.com/news',
  selector: '#news',
  title: 'サンプル公式サイト',
  cron: '0 * * * *',
  createdAt: 0,
  createdBy: 'user-1',
};

// 2026-11-23 12:05 JST
const NOW = new Date('2026-11-23T03:05:00Z').getTime();
// 2026-11-23 01:05 JST (抜き出す部分が無い時の通知を送る時間帯)
const ONE_AM_JST = new Date('2026-11-22T16:05:00Z').getTime();

function memoryStore(initial: { target?: Target | null; snapshots?: Snapshot[] } = {}) {
  const state = {
    target: initial.target === undefined ? { ...target } : initial.target,
    snapshots: [...(initial.snapshots ?? [])],
    checkedAt: undefined as number | undefined,
  };
  const store: TargetStore = {
    getTarget: () => Promise.resolve(state.target),
    getLatestSnapshot: () =>
      Promise.resolve([...state.snapshots].sort((a, b) => b.time - a.time)[0] ?? null),
    addSnapshot: (_id, snapshot) => {
      state.snapshots.push(snapshot);
      return Promise.resolve();
    },
    markChecked: (_id, checkedAt) => {
      state.checkedAt = checkedAt;
      return Promise.resolve();
    },
  };
  return { store, state };
}

function deps(store: TargetStore, fetchFragment: CrawlDeps['fetchFragment'], now = NOW) {
  const sent: SlackMessage[] = [];
  const value: CrawlDeps = {
    store,
    fetchFragment,
    notify: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    siteUrl: 'https://web-checker.example.com',
    now: () => now,
  };
  return { deps: value, sent };
}

describe('crawlTarget', () => {
  it('最初のクロールでは履歴を足し、「新規追加」を通知する', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('first');
    expect(state.snapshots).toEqual([{ content: '<li>A</li>', time: NOW }]);
    expect(sent.map((m) => m.text)).toEqual(['[サンプル公式サイト] が新規追加されました']);
    expect(state.checkedAt).toBe(NOW);
  });

  it('前回から変わっていれば履歴を足し、差分を通知する', async () => {
    const { store, state } = memoryStore({ snapshots: [{ content: '<li>A</li>', time: 1 }] });
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li><li>B</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('updated');
    expect(state.snapshots).toHaveLength(2);
    expect(sent[0].text).toBe('[サンプル公式サイト] で更新が検知されました');
    expect(JSON.stringify(sent[0].blocks)).toContain('+ B');
  });

  it('変わっていなければ通知せず、見に行った日時だけ記録する', async () => {
    const { store, state } = memoryStore({ snapshots: [{ content: '<li>A</li>', time: 1 }] });
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('unchanged');
    expect(state.snapshots).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(state.checkedAt).toBe(NOW);
  });

  it('取得に失敗したらエラーを通知し、見に行った日時は記録する (毎時同じ通知が届かないように)', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.reject(new Error('HTTP 503')));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('error');
    expect(sent[0].text).toBe('[サンプル公式サイト] でエラーが発生しました');
    expect(state.checkedAt).toBe(NOW);
    expect(state.snapshots).toHaveLength(0);
  });

  it('抜き出す部分が無ければ、JST の 1 時台以外は通知しない', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.resolve(null));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('no-content');
    expect(sent).toHaveLength(0);
    expect(state.checkedAt).toBe(NOW);
  });

  it('抜き出す部分が無ければ、JST の 1 時台に 1 回通知する', async () => {
    const { store } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.resolve(null), ONE_AM_JST);

    await crawlTarget(d, 'target-1');
    expect(sent.map((m) => m.text)).toEqual(['[サンプル公式サイト] でコンテンツが存在しませんでした']);
  });

  it('監視対象が消えていれば何もしない', async () => {
    const { store, state } = memoryStore({ target: null });
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('missing');
    expect(sent).toHaveLength(0);
    expect(state.checkedAt).toBeUndefined();
  });
});
