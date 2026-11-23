import { CronExpressionParser } from 'cron-parser';

import type { Target } from './targets';

/** cron が無い・読めない時の既定: 1 時間に 1 回 */
export const DEFAULT_CRON = '0 * * * *';

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
