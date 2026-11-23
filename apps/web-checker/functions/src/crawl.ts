import type { SlackMessage } from '@revolution/slack/post-message';

import { buildErrorMessage, buildNoContentMessage, buildUpdateMessage } from './slack-message';
import type { Snapshot, Target } from './targets';
import { formatLineDiff, toComparableText } from './text-diff';

/** 監視対象と履歴の読み書き。本番は Firestore (`firestore-store.ts`)、テストはメモリ */
export interface TargetStore {
  getTarget(targetId: string): Promise<Target | null>;
  getLatestSnapshot(targetId: string): Promise<Snapshot | null>;
  addSnapshot(targetId: string, snapshot: Snapshot): Promise<void>;
  markChecked(targetId: string, checkedAt: number): Promise<void>;
}

export interface CrawlDeps {
  store: TargetStore;
  fetchFragment: (url: string, selector: string) => Promise<string | null>;
  /** Slack に送る。失敗しても例外を投げない (`postSlackMessage` の決まり) */
  notify: (message: SlackMessage) => Promise<void>;
  /** WEB チェッカーの画面の URL (通知のリンクに使う) */
  siteUrl: string;
  now: () => number;
}

export type CrawlOutcome = 'missing' | 'error' | 'no-content' | 'unchanged' | 'first' | 'updated';

/** 抜き出す部分が無い時の通知は、1 日 1 回 (JST の 1 時台) だけにする。毎時届くと埋もれるため */
const NO_CONTENT_NOTIFY_HOUR_JST = 1;

function jstHour(time: number): number {
  return Number(
    new Date(time).toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }),
  );
}

/**
 * 監視対象を 1 件見に行き、前回の履歴と比べて、変わっていれば履歴を足して Slack に通知する。
 *
 * 失敗しても見に行った日時は記録する (記録しないと、次の毎時の見回りで同じ失敗の通知がまた届く)。
 */
export async function crawlTarget(deps: CrawlDeps, targetId: string): Promise<CrawlOutcome> {
  const target = await deps.store.getTarget(targetId);
  if (!target) return 'missing';

  const startedAt = deps.now();
  let fragment: string | null;
  try {
    fragment = await deps.fetchFragment(target.url, target.selector);
  } catch (error) {
    await deps.notify(buildErrorMessage(target, deps.siteUrl, error));
    await deps.store.markChecked(targetId, startedAt);
    return 'error';
  }

  if (fragment === null) {
    if (jstHour(startedAt) === NO_CONTENT_NOTIFY_HOUR_JST) {
      await deps.notify(buildNoContentMessage(target, deps.siteUrl));
    }
    await deps.store.markChecked(targetId, startedAt);
    return 'no-content';
  }

  const previous = await deps.store.getLatestSnapshot(targetId);
  if (previous && previous.content === fragment) {
    await deps.store.markChecked(targetId, startedAt);
    return 'unchanged';
  }

  await deps.store.addSnapshot(targetId, { content: fragment, time: startedAt });

  const newText = toComparableText(fragment);
  const oldText = previous ? toComparableText(previous.content) : '';
  await deps.notify(
    buildUpdateMessage({
      targetId,
      target,
      siteUrl: deps.siteUrl,
      detectedAt: startedAt,
      previousAt: previous?.time,
      content: newText,
      diff: formatLineDiff(oldText, newText),
    }),
  );
  await deps.store.markChecked(targetId, startedAt);
  return previous ? 'updated' : 'first';
}
