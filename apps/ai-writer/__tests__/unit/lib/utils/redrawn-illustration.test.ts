import { describe, expect, it } from '@jest/globals';

import { mentionsRedrawnIllustration, redrawnIllustrationWord } from '@/lib/utils/redrawn-illustration';

/** Layer 1: 公式ページの「描き下ろし」「描き起こし」の判定 */
describe('mentionsRedrawnIllustration', () => {
  it('漢字とひらがなの表記を拾う', () => {
    expect(mentionsRedrawnIllustration('描き下ろしイラスト')).toBe(true);
    expect(mentionsRedrawnIllustration('描きおこしイラスト')).toBe(true);
    expect(mentionsRedrawnIllustration('オリジナルイラスト')).toBe(false);
    expect(mentionsRedrawnIllustration(null)).toBe(false);
  });
});

describe('redrawnIllustrationWord', () => {
  it('最初に見つかった語を、漢字の表記にそろえて返す', () => {
    expect(redrawnIllustrationWord([null, '描きおろしの衣装'])).toBe('描き下ろし');
    expect(redrawnIllustrationWord(['描き起こしイラスト', '描き下ろし'])).toBe('描き起こし');
    expect(redrawnIllustrationWord(['描きおこし'])).toBe('描き起こし');
  });

  it('どこにも無ければ null', () => {
    expect(redrawnIllustrationWord(['オリジナル', undefined])).toBeNull();
    expect(redrawnIllustrationWord([])).toBeNull();
  });
});
