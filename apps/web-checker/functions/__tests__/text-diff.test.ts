import { describe, expect, it } from '@jest/globals';

import { formatLineDiff, toComparableText } from '../src/text-diff';

describe('toComparableText', () => {
  it('要素ごとに改行し、空白をつめる', () => {
    const html = '<li>2026.11.20  お知らせ A</li><li>お知らせ　B<br>続き</li>';
    expect(toComparableText(html)).toBe('2026.11.20 お知らせ A\nお知らせ B\n続き\n');
  });
});

describe('formatLineDiff', () => {
  it('追加は +、削除は - と取り消し線で表す', () => {
    expect(formatLineDiff('A\nB\n', 'A\nC\n')).toBe('- ~B~\n+ C\n');
  });

  it('変わっていなければ空', () => {
    expect(formatLineDiff('A\n', 'A\n')).toBe('');
  });

  it('前回が空 (最初のクロール) なら全行が追加になる', () => {
    expect(formatLineDiff('', 'A\nB\n')).toBe('+ A\n  B\n');
  });
});
