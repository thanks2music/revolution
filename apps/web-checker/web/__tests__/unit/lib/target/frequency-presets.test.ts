/**
 * プリセットの往復。プリセットに無い cron を丸めると、編集を開いて保存しただけで頻度が変わってしまう。
 */

import { DEFAULT_CRON } from '@/lib/firestore/mappers';
import { FREQUENCY_PRESETS, matchPreset } from '@/lib/target/frequency-presets';

describe('matchPreset', () => {
  it('round-trips every preset', () => {
    for (const preset of FREQUENCY_PRESETS) {
      expect(matchPreset(preset.cron)).toEqual(preset);
    }
  });

  it('treats an unknown cron as custom rather than coercing it', () => {
    expect(matchPreset('15 3 * * 2')).toBeUndefined();
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(matchPreset('  0   *   *   *   *  ')?.cron).toBe(DEFAULT_CRON);
  });

  it('uses the shared default cron for the first preset', () => {
    // Functions の既定とプリセットの既定がずれないこと
    expect(FREQUENCY_PRESETS[0].cron).toBe(DEFAULT_CRON);
  });
});
