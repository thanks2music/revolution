/**
 * Layer 1: 記事の品名と価格の読み取りと、更新の前後の違い (`pnpm debug:mdx --update`)
 */
import { describe, expect, it } from '@jest/globals';
import {
  describeItemNameDiffs,
  diffArticleItems,
  hasItemChanges,
  parseItemLine,
  readArticleItems,
} from '../../../../lib/mdx/article-item-names';

/** 古い書式の記事 (メニューは品目ごとの見出し、グッズは箇条書き、ノベルティは画像だけ) */
const before = [
  '---',
  'post_id: "01m4s065g1hchh9d"',
  '---',
  '## 作品 カフェのメニュー',
  '### 【爆豪勝己】ミートボールカレー 2,090円(税込)',
  '### 【爆豪勝己】バナナカスタードドーナツ 990円(税込)',
  '### 【轟焦凍】ラムネホワイトソーダ 990円(税込)',
  '## 作品 カフェのノベルティー',
  '### ノベルティー',
  '![ノベルティ](https://example.com/n.jpg)',
  '## 作品 カフェのグッズ',
  '### グッズ一覧',
  '- 缶バッジ（ランダム7種） 605円(税込)（店舗・オンライン）',
  '- 巾着（全7種） 1,540円(税込)（店舗・オンライン）',
].join('\n');

/** 今の書式の記事 (メニューは表、グッズは品目ごとの見出し、ノベルティは名前の見出し) */
const after = [
  '---',
  'post_id: "01m4s065g1hchh9d"',
  '---',
  '## 作品 カフェのメニュー',
  '<table>',
  '<tbody>',
  '<tr><th scope="row">爆豪勝己</th><td>ミートボールカレー 2,090円(税込)</td></tr>',
  '<tr><th scope="row">爆豪勝己</th><td>バナナカスタードアイスドーナツ 990円(税込)</td></tr>',
  '<tr><th scope="row">轟焦凍</th><td>ラムネホワイトソーダ 1,100円(税込)</td></tr>',
  '</tbody>',
  '</table>',
  '## 作品 カフェのノベルティー',
  '### ホログラムステッカー',
  '### その他参考画像',
  '## 作品 カフェのグッズ',
  '### 缶バッジ（ランダム7種） 605円(税込)',
  '販売：店舗・オンライン',
  '### 巾着（全7種） 1,540円(税込)',
].join('\n');

describe('parseItemLine', () => {
  it('品目の見出し: 【キャラ】と価格を分ける', () => {
    expect(parseItemLine('### 【爆豪勝己】バナナカスタードドーナツ 990円(税込)')).toEqual({
      name: 'バナナカスタードドーナツ',
      character: '爆豪勝己',
      price: '990円(税込)',
    });
  });

  it('HTML の表の行: th がキャラクター、td が品名と価格', () => {
    expect(parseItemLine('<tr><th scope="row">轟焦凍</th><td>ラムネホワイトソーダ 990円(税込)</td></tr>')).toEqual({
      name: 'ラムネホワイトソーダ',
      character: '轟焦凍',
      price: '990円(税込)',
    });
  });

  it('箇条書き: 価格より後ろの販売先は捨てる', () => {
    expect(parseItemLine('- 缶バッジ（ランダム7種） 605円(税込)（店舗・オンライン）')).toEqual({
      name: '缶バッジ（ランダム7種）',
      character: null,
      price: '605円(税込)',
    });
  });

  it('Markdown の表: 価格でない最初のセルが品名', () => {
    expect(parseItemLine('| 缶バッジ | 605円 | 店舗 |')).toEqual({ name: '缶バッジ', character: null, price: '605円' });
  });

  it('品名の中の「N円」は価格にしない。¥ の書式も読む', () => {
    expect(parseItemLine('### 100円ショップの袋 330円')).toEqual({ name: '100円ショップの袋', character: null, price: '330円' });
    expect(parseItemLine('| 100円ショップの袋 | ¥1,100 |')).toEqual({ name: '100円ショップの袋', character: null, price: '¥1,100' });
    expect(parseItemLine('- アクスタ ¥1,100（税込）')).toEqual({ name: 'アクスタ', character: null, price: '¥1,100（税込）' });
  });

  it('空白の後ろの「N円」で終わる語は価格とみなす (品名はその手前まで)', () => {
    expect(parseItemLine('- 缶バッジ 500円 ガチャ')).toEqual({ name: '缶バッジ', character: null, price: '500円' });
    expect(parseItemLine('- 缶バッジ 500円玉風')).toEqual({ name: '缶バッジ 500円玉風', character: null, price: null });
  });

  it('価格が無ければ null', () => {
    expect(parseItemLine('### ホログラムステッカー')).toEqual({
      name: 'ホログラムステッカー',
      character: null,
      price: null,
    });
  });

  it('品名が読めなければ null', () => {
    expect(parseItemLine('### 990円')).toBeNull();
  });
});

describe('readArticleItems', () => {
  it('節ごとに品目を読む (構造の見出しと販売の行は読まない)', () => {
    const items = readArticleItems(after);
    expect(items.menu.map((i) => i.name)).toEqual([
      'ミートボールカレー',
      'バナナカスタードアイスドーナツ',
      'ラムネホワイトソーダ',
    ]);
    expect(items.goods.map((i) => i.name)).toEqual(['缶バッジ（ランダム7種）', '巾着（全7種）']);
    expect(items.novelty.map((i) => i.name)).toEqual(['ホログラムステッカー']);
  });

  it('同じ節に HTML の表の行と Markdown の表が混ざっても読む (表の見出しの行は読まない)', () => {
    const mdx = [
      '## 作品 カフェのメニュー',
      '<tr><th scope="row">キャラA</th><td>パスタ 2,090円</td></tr>',
      '| 品名 | 価格 |',
      '|------|------|',
      '| ドリンク | 990円 |',
    ].join('\n');
    expect(readArticleItems(mdx).menu.map((i) => i.name)).toEqual(['パスタ', 'ドリンク']);
  });
});

describe('diffArticleItems', () => {
  const diffs = diffArticleItems(readArticleItems(before), readArticleItems(after));

  it('書式が違っても同じ品名は同じ品目とみなし、変わった品名は前後の両方に出す (結びつけない)', () => {
    const menu = diffs.find((d) => d.key === 'menu')!;
    expect(menu.removed.map((i) => i.name)).toEqual(['バナナカスタードドーナツ']);
    expect(menu.added.map((i) => i.name)).toEqual(['バナナカスタードアイスドーナツ']);
  });

  it('品名が同じで価格が違えば、価格の変化として出す', () => {
    const menu = diffs.find((d) => d.key === 'menu')!;
    expect(menu.priceChanged).toEqual([
      expect.objectContaining({ before: '990円(税込)', after: '1,100円(税込)' }),
    ]);
  });

  it('更新前に品名が読めない節は比べない', () => {
    const novelty = diffs.find((d) => d.key === 'novelty')!;
    expect(novelty).toMatchObject({ comparable: false, removed: [], added: [], priceChanged: [] });
  });

  it('価格の表記だけの違い (税の注記の有無・括弧の全角半角) は価格の変化にしない', () => {
    const a = readArticleItems('## メニュー\n### ドリンク 990円\n### パスタ 2,090円(税込)\n### ケーキ 800円(税込)');
    const b = readArticleItems('## メニュー\n### ドリンク 990円(税込)\n### パスタ 2,090円（税込）\n### ケーキ 800円(税抜)');
    expect(diffArticleItems(a, b).find((d) => d.key === 'menu')!.priceChanged.map((c) => c.item.name)).toEqual(['ケーキ']);
  });

  it('同じ品名で価格の違う品目は、並びが変わっても価格の変化にしない', () => {
    const a = readArticleItems('## メニュー\n### ドリンク 500円\n### ドリンク 700円');
    const b = readArticleItems('## メニュー\n### ドリンク 700円\n### ドリンク 500円');
    expect(hasItemChanges(diffArticleItems(a, b))).toBe(false);
  });

  it('品名が同じでキャラクター名が変わったら出す (片方にキャラクター名が無ければ比べない)', () => {
    const a = readArticleItems('## メニュー\n### 【爆豪勝己】ソーダ 990円\n### 【緑谷出久】パスタ 2,090円\n### カレー 1,000円');
    const b = readArticleItems('## メニュー\n### 【轟焦凍】ソーダ 990円\n### 【緑谷 出久】パスタ 2,090円\n### 【麗日お茶子】カレー 1,000円');
    const menu = diffArticleItems(a, b).find((d) => d.key === 'menu')!;
    expect(menu.characterChanged).toEqual([expect.objectContaining({ before: '爆豪勝己', after: '轟焦凍' })]);
    expect(describeItemNameDiffs([menu])).toContain('  - キャラクター名が変わった: ソーダ 【爆豪勝己】 → 【轟焦凍】');
  });

  it('removed は更新前の記事の順', () => {
    const a = readArticleItems('## メニュー\n### A 1円\n### B 1円\n### A 1円\n### C 1円');
    const b = readArticleItems('## メニュー\n### C 1円');
    expect(diffArticleItems(a, b).find((d) => d.key === 'menu')!.removed.map((i) => i.name)).toEqual(['A', 'B', 'A']);
  });

  it('同じ品名が 2 つあれば 2 つまで対応づけ、多い分を出す', () => {
    const one = readArticleItems('## メニュー\n### ドリンク 500円');
    const two = readArticleItems('## メニュー\n### ドリンク 500円\n### ドリンク 500円');
    expect(diffArticleItems(one, two).find((d) => d.key === 'menu')!.added).toHaveLength(1);
    expect(diffArticleItems(two, one).find((d) => d.key === 'menu')!.removed).toHaveLength(1);
  });

  it('変化があれば hasItemChanges が true、同じ記事なら false', () => {
    expect(hasItemChanges(diffs)).toBe(true);
    const same = readArticleItems(after);
    expect(hasItemChanges(diffArticleItems(same, same))).toBe(false);
  });
});

describe('describeItemNameDiffs', () => {
  it('節ごとの Markdown の箇条書きの行 (変化は 1 段下げる)', () => {
    expect(describeItemNameDiffs(diffArticleItems(readArticleItems(before), readArticleItems(after)))).toEqual([
      '- メニュー:',
      '  - 更新前にだけある: 【爆豪勝己】バナナカスタードドーナツ 990円(税込)',
      '  - 更新後にだけある: 【爆豪勝己】バナナカスタードアイスドーナツ 990円(税込)',
      '  - 価格が変わった: 【轟焦凍】ラムネホワイトソーダ 990円(税込) → 1,100円(税込)',
      '- グッズ: 変わっていない',
      '- ノベルティ: 比べられない (更新前の記事で品名が読めない)',
    ]);
  });
});
