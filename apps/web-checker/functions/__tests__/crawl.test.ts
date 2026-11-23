import { describe, expect, it } from '@jest/globals';
import type { SlackMessage } from '@revolution/slack/post-message';

import { ALERT_INTERVAL_MS, MAX_SNAPSHOT_CHARS, crawlTarget, type CrawlDeps, type TargetStore } from '../src/crawl';
import type { DetectedLink, Snapshot, Target } from '../src/targets';

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

function memoryStore(initial: { target?: Target | null; snapshots?: Snapshot[] } = {}) {
  const state = {
    target: initial.target === undefined ? { ...target } : initial.target,
    snapshots: [...(initial.snapshots ?? [])],
    checkedAt: undefined as number | undefined,
    alertedAt: initial.target?.alertedAt as number | undefined | null,
    addSnapshotError: null as Error | null,
    detectedLinks: [] as DetectedLink[],
    addDetectedLinksError: null as Error | null,
  };
  const store: TargetStore = {
    getTarget: () => Promise.resolve(state.target),
    getLatestSnapshot: () =>
      Promise.resolve([...state.snapshots].sort((a, b) => b.time - a.time)[0] ?? null),
    addSnapshot: (_id, snapshot) => {
      if (state.addSnapshotError) return Promise.reject(state.addSnapshotError);
      if (!state.target) return Promise.resolve(false);
      state.snapshots.push(snapshot);
      return Promise.resolve(true);
    },
    addDetectedLinks: (links) => {
      if (state.addDetectedLinksError) return Promise.reject(state.addDetectedLinksError);
      const fresh = links.filter((link) => !state.detectedLinks.some((known) => known.url === link.url));
      state.detectedLinks.push(...fresh);
      return Promise.resolve(fresh);
    },
    recordCheck: (_id, record) => {
      state.checkedAt = record.checkedAt;
      if (record.alertedAt !== undefined) state.alertedAt = record.alertedAt;
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

  it('取得に失敗したらエラーを通知し、知らせた日時と見に行った日時を記録する', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.reject(new Error('HTTP 503')));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('error');
    expect(sent[0].text).toBe('[サンプル公式サイト] でエラーが発生しました');
    expect(state.checkedAt).toBe(NOW);
    expect(state.alertedAt).toBe(NOW);
    expect(state.snapshots).toHaveLength(0);
  });

  it('前に知らせてから 24 時間たっていなければ、同じ問題は知らせ直さない', async () => {
    const { store, state } = memoryStore({ target: { ...target, alertedAt: NOW - ALERT_INTERVAL_MS + 1 } });
    const { deps: d, sent } = deps(store, () => Promise.reject(new Error('HTTP 503')));

    await crawlTarget(d, 'target-1');
    expect(sent).toHaveLength(0);
    expect(state.alertedAt).toBe(NOW - ALERT_INTERVAL_MS + 1);
    expect(state.checkedAt).toBe(NOW);
  });

  it('24 時間たてば知らせ直す', async () => {
    const { store, state } = memoryStore({ target: { ...target, alertedAt: NOW - ALERT_INTERVAL_MS } });
    const { deps: d, sent } = deps(store, () => Promise.resolve(null));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('no-content');
    expect(sent.map((m) => m.text)).toEqual(['[サンプル公式サイト] でコンテンツが存在しませんでした']);
    expect(state.alertedAt).toBe(NOW);
  });

  it('登録・編集の直後は、間隔に関係なく知らせる', async () => {
    const { store } = memoryStore({ target: { ...target, alertedAt: NOW - 1 } });
    const { deps: d, sent } = deps(store, () => Promise.resolve(null));

    await crawlTarget(d, 'target-1', { afterEdit: true });
    expect(sent).toHaveLength(1);
  });

  it('取得できたら、前に知らせた問題の記録を消す', async () => {
    const { store, state } = memoryStore({
      target: { ...target, alertedAt: NOW - 1 },
      snapshots: [{ content: '<li>A</li>', time: 1 }],
    });
    const { deps: d } = deps(store, () => Promise.resolve('<li>A</li>'));

    await crawlTarget(d, 'target-1');
    expect(state.alertedAt).toBeNull();
  });

  it('抜き出した部分が大きすぎれば保存せず、セレクタを絞るよう知らせる', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => Promise.resolve('あ'.repeat(MAX_SNAPSHOT_CHARS + 1)));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('error');
    expect(state.snapshots).toHaveLength(0);
    expect(JSON.stringify(sent[0].blocks)).toContain('セレクタを絞ってください');
    expect(state.checkedAt).toBe(NOW);
  });

  it('履歴の保存に失敗したら、エラーを知らせて見に行った日時を記録する', async () => {
    const { store, state } = memoryStore();
    state.addSnapshotError = new Error('INVALID_ARGUMENT');
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('error');
    expect(sent[0].text).toBe('[サンプル公式サイト] でエラーが発生しました');
    expect(state.checkedAt).toBe(NOW);
  });

  it('見に行っている間に監視対象が消されたら、履歴を足さず通知もしない', async () => {
    const { store, state } = memoryStore();
    const { deps: d, sent } = deps(store, () => {
      state.target = null;
      return Promise.resolve('<li>A</li>');
    });

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('missing');
    expect(state.snapshots).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('監視対象が消えていれば何もしない', async () => {
    const { store, state } = memoryStore({ target: null });
    const { deps: d, sent } = deps(store, () => Promise.resolve('<li>A</li>'));

    await expect(crawlTarget(d, 'target-1')).resolves.toBe('missing');
    expect(sent).toHaveLength(0);
    expect(state.checkedAt).toBeUndefined();
  });

  describe('通知の仕方が「AI ライターに渡す」の時', () => {
    const aiTarget: Target = { ...target, notifyMode: 'ai-writer' };
    const before = '<li><a href="/news/1">A</a></li>';
    const after = '<li><a href="/news/2">B</a></li><li><a href="/news/1">A</a></li>';

    it('新しく現れたリンクを検知リンクとして記録し、通知に載せる', async () => {
      const { store, state } = memoryStore({ target: aiTarget, snapshots: [{ content: before, time: 1 }] });
      const { deps: d, sent } = deps(store, () => Promise.resolve(after));

      await expect(crawlTarget(d, 'target-1')).resolves.toBe('updated');
      expect(state.detectedLinks).toEqual([
        { url: 'https://example.com/news/2', targetId: 'target-1', targetTitle: 'サンプル公式サイト', detectedAt: NOW },
      ]);
      expect(JSON.stringify(sent[0].blocks)).toContain('AI ライターに渡したリンク: 1 件');
    });

    it('最初のクロールでは渡さない (過去のリンクまで渡してしまうため)', async () => {
      const { store, state } = memoryStore({ target: aiTarget });
      const { deps: d, sent } = deps(store, () => Promise.resolve(after));

      await expect(crawlTarget(d, 'target-1')).resolves.toBe('first');
      expect(state.detectedLinks).toHaveLength(0);
      expect(JSON.stringify(sent[0].blocks)).not.toContain('AI ライター');
    });

    it('すでに記録されているリンクは数えない', async () => {
      const { store, state } = memoryStore({ target: aiTarget, snapshots: [{ content: before, time: 1 }] });
      state.detectedLinks.push({ url: 'https://example.com/news/2', targetId: 'other', targetTitle: '別', detectedAt: 1 });
      const { deps: d, sent } = deps(store, () => Promise.resolve(after));

      await crawlTarget(d, 'target-1');
      expect(JSON.stringify(sent[0].blocks)).toContain('AI ライターに渡したリンク: 0 件');
    });

    it('記録に失敗しても更新検知は通知し、失敗を書く', async () => {
      const { store, state } = memoryStore({ target: aiTarget, snapshots: [{ content: before, time: 1 }] });
      state.addDetectedLinksError = new Error('UNAVAILABLE');
      const { deps: d, sent } = deps(store, () => Promise.resolve(after));

      await expect(crawlTarget(d, 'target-1')).resolves.toBe('updated');
      expect(JSON.stringify(sent[0].blocks)).toContain('AI ライターに渡せませんでした');
    });

    it('新しいリンクが無ければ、渡したリンクは 0 件', async () => {
      const { store, state } = memoryStore({ target: aiTarget, snapshots: [{ content: before, time: 1 }] });
      const { deps: d, sent } = deps(store, () => Promise.resolve(`${before}<li>テキストだけ</li>`));

      await crawlTarget(d, 'target-1');
      expect(state.detectedLinks).toHaveLength(0);
      expect(JSON.stringify(sent[0].blocks)).toContain('AI ライターに渡したリンク: 0 件');
    });
  });

  it('通知の仕方が「Slack のみ」(既定) なら、リンクを渡さない', async () => {
    const { store, state } = memoryStore({ snapshots: [{ content: '<a href="/a">A</a>', time: 1 }] });
    const { deps: d, sent } = deps(store, () => Promise.resolve('<a href="/b">B</a><a href="/a">A</a>'));

    await crawlTarget(d, 'target-1');
    expect(state.detectedLinks).toHaveLength(0);
    expect(JSON.stringify(sent[0].blocks)).not.toContain('AI ライター');
  });
});
