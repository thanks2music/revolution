import { describe, expect, it } from '@jest/globals';
import { OCCURRENCE_STATUS_VALUES } from '@revolution/schemas/occurrence';

import { formatPeriod, formatPeriodTense } from '@/lib/occurrence/format';

/**
 * `lib/occurrence/format.ts` の期間表示 (Layer 1 = 純粋関数)。
 *
 * ## 何を固定したいか
 *
 * 日付の null は **2 種類あってどちらも欠損ではない**。空欄にすると
 * 「データが抜けている」に見えて事実が伝わらないため、明示的な言葉になることを
 * テストで固定する。
 */

describe('formatPeriod', () => {
  it('formats a closed period', () => {
    expect(formatPeriod('2026-07-03', '2026-08-16')).toBe('2026.07.03 〜 2026.08.16');
  });

  it('says 日程未発表 when starts_on is null (欠損ではなく正規の状態)', () => {
    expect(formatPeriod(null, '2026-08-16')).toBe('日程未発表');
    expect(formatPeriod(null, null)).toBe('日程未発表');
  });

  it('says 終了日未定 when only ends_on is null (常設・終了日未定)', () => {
    expect(formatPeriod('2026-07-03', null)).toBe('2026.07.03 〜 (終了日未定)');
  });
});

describe('formatPeriodTense', () => {
  it('adds a past tense to ended and a cancelled-plan tense to cancelled', () => {
    // 同じ日付が「もう終わった」のか「中止になった予定」なのかを、
    // 状態バッジまで視線を往復せずに読めるようにする (v6 #16)。
    expect(formatPeriodTense('ended')).toBe(' に開催');
    expect(formatPeriodTense('cancelled')).toBe(' の予定');
  });

  it('adds nothing to the statuses whose dates read as-is', () => {
    expect(formatPeriodTense('ongoing')).toBe('');
    expect(formatPeriodTense('scheduled')).toBe('');
  });

  it('adds nothing to unscheduled (formatPeriod が既に完成した文を返すため)', () => {
    // '日程未発表' + ' に開催' のような二重表現を作らない。
    expect(formatPeriodTense('unscheduled')).toBe('');
    expect(`${formatPeriod(null, null)}${formatPeriodTense('unscheduled')}`).toBe('日程未発表');
  });

  it('covers every status the view can return', () => {
    // view に状態が増えたら Record が型エラーになるが、実行時にも押さえる。
    for (const status of OCCURRENCE_STATUS_VALUES) {
      expect(typeof formatPeriodTense(status)).toBe('string');
    }
  });
});
