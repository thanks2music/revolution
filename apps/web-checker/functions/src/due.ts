import { CronExpressionParser } from 'cron-parser';

import type { Target } from './targets';

/** cron が無い・読めない時の既定: 1 時間に 1 回 */
const DEFAULT_CRON = '0 * * * *';

const TIME_ZONE = 'Asia/Tokyo';

function previousFireTime(cron: string, now: Date): Date {
  return CronExpressionParser.parse(cron, { tz: TIME_ZONE, currentDate: now }).prev().toDate();
}

/**
 * 監視対象を今見に行くべきか。
 *
 * 監視対象の cron が直前に発火した時刻より後に見に行っていれば、見に行かない。
 * 見回り (`dispatch`) は毎時 1 回なので、cron をそれより細かくしても 1 時間に 1 回になる。
 */
export function isDue(target: Pick<Target, 'cron' | 'checkedAt'>, now: Date): boolean {
  if (target.checkedAt === undefined) return true;

  let previous: Date;
  try {
    previous = previousFireTime(target.cron || DEFAULT_CRON, now);
  } catch {
    previous = previousFireTime(DEFAULT_CRON, now);
  }
  return target.checkedAt <= previous.getTime();
}

/** 作成の直後のクロールに任せる時間。この間に来た見回りは、まだ見ていない監視対象でも飛ばす */
const EDIT_CRAWL_GRACE_MS = 10 * 60 * 1000;

/**
 * 作成の直後のクロール (`webCheckerOnTargetWrite`) がまだ動いている最中か。
 * 作成が見回り (毎時 5 分) の直前だと、両方が「前回の履歴が無い」と見て、「新規追加」が 2 通届くため。
 */
export function isLeftToEditCrawl(target: Pick<Target, 'checkedAt' | 'createdAt'>, now: Date): boolean {
  return target.checkedAt === undefined && now.getTime() - target.createdAt < EDIT_CRAWL_GRACE_MS;
}
