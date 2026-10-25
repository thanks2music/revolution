/**
 * Layer 1: 記事の更新で、公開中の記事の品名を正にする (`lib/mdx/keep-published-names.ts`)
 */
import { describe, expect, it } from '@jest/globals';
import { readArticleItems } from '../../../../lib/mdx/article-item-names';
import { describeKeptNames, keepPublishedNames, publishedNamesFor, similarNames } from '../../../../lib/mdx/keep-published-names';

/** 公開中の記事 (ヒロアカの爆豪の品目。人が「バナナカスタードドーナツ」に直した後) */
const published = readArticleItems(
  [
    '## 作品 カフェのメニュー',
    '<tr><th scope="row">爆豪勝己</th><td>ミートボールカレー 2,090円(税込)</td></tr>',
    '<tr><th scope="row">爆豪勝己</th><td>バナナカスタードドーナツ 990円(税込)</td></tr>',
    '<tr><th scope="row">爆豪勝己</th><td>オレンジソーダ 990円(税込)</td></tr>',
    '## 作品 カフェのノベルティー',
    '### ホログラムステッカー',
    '## 作品 カフェのグッズ',
    '### 缶バッジ（ランダム7種） 605円(税込)',
    '### 巾着（全7種） 1,540円(税込)',
  ].join('\n')
);

const menuItem = (character: string | null, name: string, price: string | null) => ({
  character,
  name,
  price,
  imageUrl: null,
  copyright: null,
});

/** 今回の抽出 (Vision がドーナツを読み違えた) */
const extraction = {
  メニュー詳細リスト: [
    menuItem('爆豪勝己', 'ミートボールカレー', '2,090円(税込)'),
    menuItem('爆豪勝己', 'バナナカスタードアイスドーナツ', '990円(税込)'),
    menuItem('爆豪勝己', 'オレンジソーダ', '990円(税込)'),
  ],
  具体的なメニュー名リスト: ['ミートボールカレー', 'バナナカスタードアイスドーナツ', 'オレンジソーダ'],
  グッズ詳細リスト: [
    { name: '缶バッジ（ランダム7種）', price: '605円(税込)', sales: null },
    { name: '巾着（全7種）', price: '1,540円(税込)', sales: null },
  ],
  グッズ名: ['缶バッジ（ランダム7種）', '巾着（全7種）'],
  ノベルティ名: ['ホログラムステッカー'],
};

describe('keepPublishedNames', () => {
  it('同じキャラクター・同じ価格で 1 品どうしだけ残ったら、公開中の記事の品名を使う (ヒロアカ)', () => {
    const result = keepPublishedNames(extraction, published);
    expect(result.extraction.メニュー詳細リスト.map((m) => m.name)).toEqual([
      'ミートボールカレー',
      'バナナカスタードドーナツ',
      'オレンジソーダ',
    ]);
    expect(result.extraction.具体的なメニュー名リスト).toEqual(['ミートボールカレー', 'バナナカスタードドーナツ', 'オレンジソーダ']);
    expect(result.kept).toEqual([
      {
        key: 'menu',
        label: 'メニュー',
        read: 'バナナカスタードアイスドーナツ',
        published: 'バナナカスタードドーナツ',
        character: '爆豪勝己',
        price: '990円(税込)',
      },
    ]);
  });

  it('品名がすべて一致すれば、元の結果をそのまま返す', () => {
    const same = { ...extraction, メニュー詳細リスト: extraction.メニュー詳細リスト.map((m, i) => (i === 1 ? { ...m, name: 'バナナカスタードドーナツ' } : m)) };
    const result = keepPublishedNames(same, published);
    expect(result.kept).toEqual([]);
    expect(result.extraction).toBe(same);
  });

  it('価格が違えば当てない (別の品目かもしれない)', () => {
    const priced = {
      ...extraction,
      メニュー詳細リスト: extraction.メニュー詳細リスト.map((m, i) => (i === 1 ? { ...m, price: '1,100円(税込)' } : m)),
    };
    expect(keepPublishedNames(priced, published).kept).toEqual([]);
  });

  it('キャラクターが違えば当てない', () => {
    const other = {
      ...extraction,
      メニュー詳細リスト: extraction.メニュー詳細リスト.map((m, i) => (i === 1 ? { ...m, character: '轟焦凍' } : m)),
    };
    expect(keepPublishedNames(other, published).kept).toEqual([]);
  });

  it('同じ組に 2 品以上残れば、どれがどれか決められないので当てない', () => {
    const two = {
      ...extraction,
      メニュー詳細リスト: [
        ...extraction.メニュー詳細リスト.slice(0, 2),
        menuItem('爆豪勝己', 'オレンジスカッシュ', '990円(税込)'),
      ],
    };
    // 公開中の記事: ドーナツ・ソーダ (990 円) が残り、今回: アイスドーナツ・スカッシュ (990 円) が残る → 2 対 2
    expect(keepPublishedNames(two, published).kept).toEqual([]);
  });

  it('グッズは詳細リストと名前の一覧の両方を直す。価格の表記の違い (税込の有無) は同じ価格とみなす', () => {
    const goods = {
      ...extraction,
      グッズ詳細リスト: [
        { name: '缶バッチ（ランダム7種）', price: '605円', sales: null },
        { name: '巾着（全7種）', price: '1,540円(税込)', sales: null },
      ],
      グッズ名: ['缶バッチ（ランダム7種）', '巾着（全7種）'],
    };
    const result = keepPublishedNames(goods, published);
    expect(result.extraction.グッズ詳細リスト.map((g) => g.name)).toEqual(['缶バッジ（ランダム7種）', '巾着（全7種）']);
    expect(result.extraction.グッズ名).toEqual(['缶バッジ（ランダム7種）', '巾着（全7種）']);
    // メニューのドーナツも当たる (fixture の extraction のまま)
    expect(result.kept.map((k) => k.key)).toEqual(['menu', 'goods']);
  });

  it('ノベルティも 1 品どうしなら当てる', () => {
    const result = keepPublishedNames({ ...extraction, ノベルティ名: ['ホログラムステッガー'] }, published);
    expect(result.extraction.ノベルティ名).toEqual(['ホログラムステッカー']);
  });

  it('名前が似ていなければ当てない (公式が品目を入れ替えた可能性が高い。キャラクターも価格も無いノベルティでも)', () => {
    expect(keepPublishedNames({ ...extraction, ノベルティ名: ['アクリルコースター'] }, published).kept.map((k) => k.key)).toEqual(['menu']);
    const swapped = {
      ...extraction,
      メニュー詳細リスト: extraction.メニュー詳細リスト.map((m, i) => (i === 1 ? { ...m, name: 'チョコバナナパフェ' } : m)),
    };
    expect(keepPublishedNames(swapped, published).kept).toEqual([]);
  });

  it('詳細リストが空なら名前の一覧を直す (同じ名前が 2 つあっても、対応した 1 つだけ)', () => {
    const namesOnly = {
      ...extraction,
      グッズ詳細リスト: null,
      グッズ名: ['缶バッチ（ランダム7種）', '巾着（全7種）'],
    };
    const goodsPublished = readArticleItems('## 作品 カフェのグッズ\n- 缶バッジ（ランダム7種）\n- 巾着（全7種）');
    const result = keepPublishedNames(namesOnly, { ...published, goods: goodsPublished.goods });
    expect(result.extraction.グッズ名).toEqual(['缶バッジ（ランダム7種）', '巾着（全7種）']);
  });

  it('公開中の記事で品名が読めない節 (古い書式) には当てない', () => {
    const legacy = readArticleItems('## 作品 カフェのメニュー\n### メニューラインナップ\n![メニュー](https://example.com/m.jpg)');
    expect(keepPublishedNames(extraction, legacy).kept).toEqual([]);
  });
});

describe('publishedNamesFor', () => {
  it('品名で対応のついた品目は数に入れない (同じ価格のソーダがあっても、ドーナツどうしが 1 対 1 で残る)', () => {
    const read = extraction.メニュー詳細リスト.map(({ name, character, price }) => ({ name, character, price }));
    const map = publishedNamesFor(read, published.menu);
    expect([...map.keys()]).toEqual([1]);
    expect(map.get(1)?.name).toBe('バナナカスタードドーナツ');
  });
});

describe('describeKeptNames', () => {
  it('当てた品目の行。無ければ「なし」', () => {
    expect(describeKeptNames(keepPublishedNames(extraction, published).kept)).toEqual([
      '- メニュー (【爆豪勝己】 990円(税込)): 今回読んだ「バナナカスタードアイスドーナツ」ではなく、公開中の記事の「バナナカスタードドーナツ」を使った',
    ]);
    expect(describeKeptNames([])).toEqual(['- なし']);
  });
});

describe('similarNames', () => {
  it('読み違いらしい名前は似ている。別の品目は似ていない', () => {
    expect(similarNames('バナナカスタードドーナツ', 'バナナカスタードアイスドーナツ')).toBe(true);
    expect(similarNames('てりマヨチキン', 'テリヤキチキン')).toBe(true);
    expect(similarNames('オレンジソーダ', 'ピーチソーダ')).toBe(false);
    expect(similarNames('ホログラムステッカー', 'アクリルコースター')).toBe(false);
  });
});
