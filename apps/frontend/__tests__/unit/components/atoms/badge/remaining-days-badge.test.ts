import { describe, expect, it } from '@jest/globals';

import {
  DAYS_SOON_MAX,
  DAYS_URGENT_MAX,
  toTier,
} from '@/components/atoms/badge/RemainingDaysBadge';

/**
 * 残日数の 3 段階写像 (Layer 1)。
 *
 * しきい値そのものは暫定値 (デザイン未確定) だが、**境界の挙動**
 * (「以下」か「未満」か) は仕様として固定する。ここが緩むと、しきい値を
 * 差し替えたときに 1 日ぶん静かにずれる。
 */
describe('toTier', () => {
  it('treats the urgent threshold as inclusive', () => {
    expect(toTier(DAYS_URGENT_MAX)).toBe('urgent');
    expect(toTier(DAYS_URGENT_MAX + 1)).toBe('soon');
  });

  it('treats the soon threshold as inclusive', () => {
    expect(toTier(DAYS_SOON_MAX)).toBe('soon');
    expect(toTier(DAYS_SOON_MAX + 1)).toBe('normal');
  });

  it('treats the last day as urgent', () => {
    expect(toTier(0)).toBe('urgent');
  });

  it('classifies a long-running occurrence as normal', () => {
    expect(toTier(60)).toBe('normal');
  });

  it('keeps the thresholds ordered', () => {
    // 差し替え時に urgent > soon と逆転させてしまうと、soon が到達不能になる。
    expect(DAYS_URGENT_MAX).toBeLessThan(DAYS_SOON_MAX);
  });
});
