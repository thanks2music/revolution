/**
 * 日時の表示は日本時間に固定する。cron も Slack の通知も Asia/Tokyo なので、ブラウザのタイムゾーンに
 * 任せると、設定や通知と画面の時刻が食い違う。
 */

const JST_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

/** 日時が無い時の表示 */
export const EMPTY_DATE_LABEL = '-';

/** ms の epoch を日本時間の文字列にする。null や不正な値は `-` */
export function formatJst(epochMillis: number | null | undefined): string {
  if (typeof epochMillis !== 'number' || !Number.isFinite(epochMillis)) {
    return EMPTY_DATE_LABEL;
  }

  const date = new Date(epochMillis);
  if (Number.isNaN(date.getTime())) return EMPTY_DATE_LABEL;

  return date.toLocaleString('ja-JP', JST_FORMAT);
}
