import { describe, expect, it } from '@jest/globals';

import { findUnclosedVoidElements, selfCloseVoidElements } from '@/lib/utils/mdx-safety';

describe('selfCloseVoidElements', () => {
  it('<br> を自己閉じにする', () => {
    expect(selfCloseVoidElements('登場します。<br>')).toBe('登場します。<br />');
  });

  it('属性つきの void 要素も自己閉じにする', () => {
    expect(selfCloseVoidElements('<img src="a.png" alt="図">')).toBe(
      '<img src="a.png" alt="図" />'
    );
  });

  it('既に自己閉じなら変更しない', () => {
    const mdx = '既に<br />です';
    expect(selfCloseVoidElements(mdx)).toBe(mdx);
  });

  it('複数の void 要素をすべて処理する', () => {
    expect(selfCloseVoidElements('A<br>B<hr>C')).toBe('A<br />B<hr />C');
  });

  it('void 要素でないタグには触れない', () => {
    const mdx = '<div>本文</div><span>強調</span>';
    expect(selfCloseVoidElements(mdx)).toBe(mdx);
  });

  it('大文字小文字を問わず処理する', () => {
    expect(selfCloseVoidElements('A<BR>B')).toBe('A<BR />B');
  });

  // コード例として HTML の書き方を説明している可能性があるため触らない
  it('コードフェンス内は変更しない', () => {
    const mdx = ['説明', '```html', '<br>', '```', '本文<br>'].join('\n');
    expect(selfCloseVoidElements(mdx)).toBe(
      ['説明', '```html', '<br>', '```', '本文<br />'].join('\n')
    );
  });

  it('インラインコード内は変更しない', () => {
    expect(selfCloseVoidElements('`<br>` と書く。実際は<br>')).toBe(
      '`<br>` と書く。実際は<br />'
    );
  });

  it('void 要素が無ければ入力をそのまま返す', () => {
    const mdx = '## 見出し\n\n本文です。';
    expect(selfCloseVoidElements(mdx)).toBe(mdx);
  });
});

describe('findUnclosedVoidElements', () => {
  it('自己閉じでない void 要素を列挙する', () => {
    expect(findUnclosedVoidElements('A<br>B<hr>')).toEqual(['<br>', '<hr>']);
  });

  it('自己閉じ済みは検出しない', () => {
    expect(findUnclosedVoidElements('A<br />B')).toEqual([]);
  });

  it('重複は 1 件に畳む', () => {
    expect(findUnclosedVoidElements('A<br>B<br>')).toEqual(['<br>']);
  });

  it('コードフェンス内は検出しない', () => {
    expect(findUnclosedVoidElements('```\n<br>\n```')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 回帰テスト: 2026-08-16 の再実走でビルドを落とした実データ。
//
// Error occurred prerendering page "/articles/01m02zkq4xb26jge"
// [next-mdx-remote] error compiling MDX:
// Expected a closing tag for `<br>` (11:64-11:68) before the end of `paragraph`
// ────────────────────────────────────────────────────────────────────────────
describe('ビルドを落とした実データ (回帰)', () => {
  const actual =
    'ポチャッコのフォトジェニックなメニューや、ブルーやグリーンの爽やかな' +
    'アクセントカラーを取り入れた涼しげなメニューが登場します。<br>\n' +
    'メニュー名は、ポチャッコの額縁たまごサンド、ポチャッコのブラッククリームブリュレ、' +
    'レモンスカッシュフロートなど、見た目も味わいも楽しめるラインアップです。';

  it('検出できる', () => {
    expect(findUnclosedVoidElements(actual)).toEqual(['<br>']);
  });

  it('正規化後は検出ゼロになる', () => {
    const fixed = selfCloseVoidElements(actual);

    expect(findUnclosedVoidElements(fixed)).toEqual([]);
    expect(fixed).toContain('登場します。<br />');
    // 本文は失われない
    expect(fixed).toContain('レモンスカッシュフロート');
  });
});
