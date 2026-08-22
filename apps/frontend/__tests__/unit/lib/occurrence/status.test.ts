import { describe, expect, it } from '@jest/globals';
import { OCCURRENCE_STATUS_VALUES } from '@revolution/schemas/occurrence';

import { diffInDays, todayInJst, toBadgeStatus } from '@/lib/occurrence/status';

describe('toBadgeStatus', () => {
  it('maps every value occurrence_view can return', () => {
    expect(toBadgeStatus('scheduled')).toBe('coming-soon');
    expect(toBadgeStatus('ongoing')).toBe('now');
    expect(toBadgeStatus('ended')).toBe('ended');
    expect(toBadgeStatus('unscheduled')).toBe('unscheduled');
    expect(toBadgeStatus('cancelled')).toBe('cancelled');
  });

  /**
   * 型レベルの網羅性は `never` 代入で担保しているが、それは**コンパイル時のみ**。
   * zod の enum に値が増えて写像を足し忘れたケースを実行時にも捕まえる。
   *
   * `0016` で `unscheduled` を追加したとき zod 側の更新が漏れた前例があるため
   * (claude[bot] PR #291)、同じ漏れを表示側で再演しないための保険。
   */
  it('covers OCCURRENCE_STATUS_VALUES exhaustively at runtime', () => {
    for (const status of OCCURRENCE_STATUS_VALUES) {
      expect(typeof toBadgeStatus(status)).toBe('string');
    }
  });

  it('never returns the article-only "unknown" badge', () => {
    // 開催は必ず状態が導出されるので「詳細を確認」には落ちない。
    // ここが unknown を返し始めたら、view の値を取りこぼしている。
    const mapped = OCCURRENCE_STATUS_VALUES.map(toBadgeStatus);
    expect(mapped).not.toContain('unknown');
  });
});

describe('todayInJst', () => {
  it('returns the JST date, not the UTC date', () => {
    // 2026-08-14 15:30 UTC = 2026-08-15 00:30 JST。日付が 1 日ずれる時刻。
    // ここが UTC のままだと、DB が ongoing と言っているのに残日数が
    // 合わないという食い違いが出る。
    expect(todayInJst(new Date('2026-08-14T15:30:00Z'))).toBe('2026-08-15');
  });

  it('keeps the same date when UTC and JST agree', () => {
    expect(todayInJst(new Date('2026-08-14T01:00:00Z'))).toBe('2026-08-14');
  });

  it('crosses the year boundary in JST', () => {
    // 2026-12-31 15:30 UTC = 2027-01-01 00:30 JST
    expect(todayInJst(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01-01');
  });
});

describe('diffInDays', () => {
  it('returns 0 for the same day', () => {
    expect(diffInDays('2026-08-14', '2026-08-14')).toBe(0);
  });

  it('returns a positive number for a future date', () => {
    expect(diffInDays('2026-08-14', '2026-08-20')).toBe(6);
  });

  it('returns a negative number for a past date', () => {
    expect(diffInDays('2026-08-14', '2026-08-10')).toBe(-4);
  });

  it('crosses month boundaries', () => {
    expect(diffInDays('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('crosses year boundaries', () => {
    expect(diffInDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('handles a leap day', () => {
    expect(diffInDays('2028-02-28', '2028-03-01')).toBe(2);
  });
});
