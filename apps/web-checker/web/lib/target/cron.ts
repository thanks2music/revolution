/**
 * cron の検証と、次に見に行く時刻の計算。
 *
 * Functions と同じ cron-parser (v5) を、同じタイムゾーン (Asia/Tokyo) で使う。正規表現で形だけ見ると、
 * Functions が読めずに既定に倒す式 (例: `0 25 * * *`) を画面が通してしまい、「保存できたのに設定した
 * 時刻に動かない」ことになるため。
 * @see apps/web-checker/functions/src/due.ts
 *
 * cron-parser は luxon を引くので、検証が要る時に初めて読み込む (dynamic import)。
 */

export type CronValidation = { ok: true; nextCheckAt: Date } | { ok: false; reason: string };

const CRON_TZ = 'Asia/Tokyo';

/**
 * 見回り (`webCheckerDispatch`) が動く分。Functions の schedule `'5 * * * *'` と同じ。
 * @see apps/web-checker/functions/src/index.ts
 */
const DISPATCH_MINUTE = 5;

/**
 * cron が発火する時刻から、実際に見に行く時刻を求める。
 *
 * 見回りは毎時 05 分にしか動かず、その時に「cron が直前に発火した時刻より後に見に行ったか」を見る。
 * そのため実際に見に行くのは、cron の発火時刻の後で最初に来る :05 になる (9:00 なら 9:05、9:30 なら 10:05)。
 */
function toNextDispatch(cronFireAt: Date): Date {
  const tick = new Date(cronFireAt);
  tick.setSeconds(0, 0);

  if (tick.getMinutes() <= DISPATCH_MINUTE) {
    tick.setMinutes(DISPATCH_MINUTE);
  } else {
    tick.setHours(tick.getHours() + 1, DISPATCH_MINUTE);
  }

  return tick;
}

/** cron を検証し、読めれば次に見に行く時刻 (見回りの時刻に合わせた物) を返す */
export async function validateCron(expression: string): Promise<CronValidation> {
  const trimmed = expression.trim();
  if (trimmed === '') {
    return { ok: false, reason: '頻度を入力してください' };
  }

  const { CronExpressionParser } = await import('cron-parser');

  try {
    const interval = CronExpressionParser.parse(trimmed, { tz: CRON_TZ });
    return { ok: true, nextCheckAt: toNextDispatch(interval.next().toDate()) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'cron の書き方が正しくありません',
    };
  }
}
