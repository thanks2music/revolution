import type { SlackMessage } from '@revolution/slack/post-message';

import { buildErrorMessage, buildNoContentMessage, buildUpdateMessage } from './slack-message';
import type { Snapshot, Target } from './targets';
import { formatLineDiff, toComparableText } from './text-diff';

/** 見に行った結果の記録。`alertedAt: null` は消す (問題が解消した) */
export interface CheckRecord {
  checkedAt: number;
  alertedAt?: number | null;
}

/** 監視対象と履歴の読み書き。本番は Firestore (`firestore-store.ts`)、テストはメモリ */
export interface TargetStore {
  getTarget(targetId: string): Promise<Target | null>;
  getLatestSnapshot(targetId: string): Promise<Snapshot | null>;
  /** 履歴を足す。監視対象がもう無ければ足さずに `false` (削除と見回りが重なった時に、履歴だけ残さない) */
  addSnapshot(targetId: string, snapshot: Snapshot): Promise<boolean>;
  recordCheck(targetId: string, record: CheckRecord): Promise<void>;
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

export interface CrawlOptions {
  /**
   * 監視対象を登録・編集した直後のクロールか。直後は、取得の失敗や抜き出す部分が無いことを必ず知らせる
   * (登録した人が、URL やセレクタの誤りにすぐ気付けるように)
   */
  afterEdit?: boolean;
}

export type CrawlOutcome = 'missing' | 'error' | 'no-content' | 'unchanged' | 'first' | 'updated';

/** 同じ問題 (取得の失敗・抜き出す部分が無い) を知らせ直す間隔。毎時届くと埋もれるため */
export const ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 履歴 1 件に保存する HTML の上限 (文字数)。Firestore の 1 ドキュメントは約 1 MiB までで、
 * 日本語は UTF-8 で 1 文字 3 バイトになるため、30 万字に抑える。超えたらセレクタを絞ってもらう
 */
export const MAX_SNAPSHOT_CHARS = 300_000;

/**
 * 監視対象を 1 件見に行き、前回の履歴と比べて、変わっていれば履歴を足して Slack に通知する。
 *
 * 問題 (取得の失敗・抜き出す部分が無い) は、最初の 1 回と、その後は 24 時間に 1 回だけ知らせる。
 * どの結果でも見に行った日時は記録する。
 */
export async function crawlTarget(
  deps: CrawlDeps,
  targetId: string,
  options: CrawlOptions = {},
): Promise<CrawlOutcome> {
  const target = await deps.store.getTarget(targetId);
  if (!target) return 'missing';

  const startedAt = deps.now();

  /** 問題を知らせるか決めて、知らせたら記録に残す */
  const alert = async (message: SlackMessage): Promise<void> => {
    const due =
      options.afterEdit || target.alertedAt === undefined || startedAt - target.alertedAt >= ALERT_INTERVAL_MS;
    if (due) await deps.notify(message);
    await deps.store.recordCheck(targetId, {
      checkedAt: startedAt,
      ...(due ? { alertedAt: startedAt } : {}),
    });
  };

  let fragment: string | null;
  try {
    fragment = await deps.fetchFragment(target.url, target.selector);
  } catch (error) {
    await alert(buildErrorMessage(target, deps.siteUrl, error));
    return 'error';
  }

  if (fragment === null) {
    await alert(buildNoContentMessage(target, deps.siteUrl));
    return 'no-content';
  }
  if (fragment.length > MAX_SNAPSHOT_CHARS) {
    const error = new Error(
      `抜き出した部分が大きすぎます (${fragment.length} 字、上限 ${MAX_SNAPSHOT_CHARS} 字)。セレクタを絞ってください`,
    );
    await alert(buildErrorMessage(target, deps.siteUrl, error));
    return 'error';
  }

  // 取得できたので、前に知らせた問題は解消した扱いにする
  const resolved: CheckRecord = { checkedAt: startedAt, ...(target.alertedAt !== undefined ? { alertedAt: null } : {}) };

  const previous = await deps.store.getLatestSnapshot(targetId);
  if (previous && previous.content === fragment) {
    await deps.store.recordCheck(targetId, resolved);
    return 'unchanged';
  }

  let saved: boolean;
  try {
    saved = await deps.store.addSnapshot(targetId, { content: fragment, time: startedAt });
  } catch (error) {
    await alert(buildErrorMessage(target, deps.siteUrl, error));
    return 'error';
  }
  if (!saved) return 'missing';

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
  await deps.store.recordCheck(targetId, resolved);
  return previous ? 'updated' : 'first';
}
