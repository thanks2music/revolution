import { describe, expect, it } from '@jest/globals';

import { isDue } from '../src/due';

// 2026-11-23 12:05 JST (= 03:05 UTC)
const now = new Date('2026-11-23T03:05:00Z');
const at = (iso: string) => new Date(iso).getTime();

describe('isDue', () => {
  it('一度も見に行っていなければ見に行く', () => {
    expect(isDue({ cron: '0 * * * *' }, now)).toBe(true);
  });

  it('毎時の cron で、直前の発火 (12:00 JST) より前に見ていれば見に行く', () => {
    expect(isDue({ cron: '0 * * * *', checkedAt: at('2026-11-23T02:05:00Z') }, now)).toBe(true);
  });

  it('直前の発火より後に見ていれば見に行かない', () => {
    expect(isDue({ cron: '0 * * * *', checkedAt: at('2026-11-23T03:01:00Z') }, now)).toBe(false);
  });

  it('cron は Asia/Tokyo で評価する (毎日 9 時 JST)', () => {
    // 直前の発火は 2026-11-23 09:00 JST = 00:00 UTC
    expect(isDue({ cron: '0 9 * * *', checkedAt: at('2026-11-22T23:59:00Z') }, now)).toBe(true);
    expect(isDue({ cron: '0 9 * * *', checkedAt: at('2026-11-23T00:05:00Z') }, now)).toBe(false);
  });

  it('cron が読めなければ 1 時間に 1 回として扱う', () => {
    expect(isDue({ cron: 'not a cron', checkedAt: at('2026-11-23T02:05:00Z') }, now)).toBe(true);
    expect(isDue({ cron: 'not a cron', checkedAt: at('2026-11-23T03:01:00Z') }, now)).toBe(false);
  });

  it('cron が空なら 1 時間に 1 回として扱う', () => {
    expect(isDue({ cron: '', checkedAt: at('2026-11-23T03:01:00Z') }, now)).toBe(false);
  });
});
