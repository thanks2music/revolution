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
    expect(formatPeriodTense('ended', '2026-02-10')).toBe(' に開催');
    expect(formatPeriodTense('cancelled', '2026-06-05')).toBe(' の予定');
  });

  it('adds nothing to the statuses whose dates read as-is', () => {
    expect(formatPeriodTense('ongoing', '2026-07-03')).toBe('');
    expect(formatPeriodTense('scheduled', '2026-08-28')).toBe('');
  });

  /**
   * ★ 二重表現の回帰テスト (2026-08-22 `/code-review` 指摘)。
   *
   * `occurrence_view` の CASE は **`cancelled` を `unscheduled` より先**に
   * 評価するため、`cancelled_at` があって `starts_on` が null の開催は
   * `'cancelled'` で返る。`status` だけで時制を決めると
   * **「日程未発表 の予定」**という二重表現になる。
   */
  it('adds nothing when starts_on is null, whatever the status says', () => {
    for (const status of OCCURRENCE_STATUS_VALUES) {
      expect(formatPeriodTense(status, null)).toBe('');
      // `formatPeriod` の戻り値と連結しても文が壊れないこと。
      expect(`${formatPeriod(null, null)}${formatPeriodTense(status, null)}`).toBe('日程未発表');
    }
  });

  it('covers every status the view can return', () => {
    for (const status of OCCURRENCE_STATUS_VALUES) {
      expect(typeof formatPeriodTense(status, '2026-01-01')).toBe('string');
    }
  });
});
