/**
 * 日時の表示は日本時間に固定する (cron も Slack の通知も Asia/Tokyo のため)。
 */

import { EMPTY_DATE_LABEL, formatJst } from '@/lib/format-date';

describe('formatJst', () => {
  it('renders in JST regardless of the host timezone', () => {
    // 2026-07-26T00:00:00Z = JST 09:00
    const result = formatJst(Date.UTC(2026, 6, 26, 0, 0, 0));

    expect(result).toContain('2026');
    expect(result).toContain('09:00:00');
  });

  it('crosses the date boundary correctly', () => {
    // 2026-07-25T16:00:00Z = JST 07-26 01:00。UTC だと前日になる
    const result = formatJst(Date.UTC(2026, 6, 25, 16, 0, 0));

    expect(result).toContain('07/26');
    expect(result).toContain('01:00:00');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('returns the placeholder for %s instead of throwing', (_label, value) => {
    expect(formatJst(value as number | null | undefined)).toBe(EMPTY_DATE_LABEL);
  });
});
