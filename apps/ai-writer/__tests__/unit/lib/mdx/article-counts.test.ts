/**
 * Layer 1: 記事の会場・品目の数と、更新の前後の減少チェック (`pnpm debug:mdx --update`)
 */
import { describe, expect, it } from '@jest/globals';
import {
  checkShrink,
  shrinkStopMessage,
  countArticleItems,
  countSectionItems,
  describeShrinkCheck,
  type ArticleCounts,
} from '../../../../lib/mdx/article-counts';

const frontmatter = (venues: number) =>
  [
    '---',
    'post_id: "01m4s065g1hchh9d"',
    'title: "タイトル"',
    ...(venues > 0
      ? [
          'event_data:',
          '  primary_category_slug: "collabo-cafe"',
          '  occurrences:',
          ...Array.from({ length: venues }, (_, i) => [
            `    - venue_slug: null`,
            `      venue_label: "会場${i + 1}"`,
            `      starts_on: "2026-10-16"`,
          ]).flat(),
        ]
      : []),
    '---',
  ].join('\n');

/** 今の書式の記事 (品目の見出し、グッズの箇条書き、ノベルティ名の見出し) */
const current = [
  frontmatter(4),
  '',
  '## 作品 カフェのメニュー',
  '',
  '### 【キャラA】パスタ 2,090円(税込)',
  '![メニュー1](https://example.com/1.jpg)',
  '### 【キャラB】カレー 2,090円(税込)',
  '### ドリンク',
  '### その他参考画像',
  '![メニュー2](https://example.com/2.jpg)',
  '',
  '## 作品 カフェのノベルティー',
  '',
  '「作品」カフェでは、ノベルティー「ステッカー」「コースター」が用意されている。',
  '### ステッカー',
  '### コースター',
  '',
  '## 作品 カフェのグッズ',
  '',
  '### グッズ一覧',
  '- 缶バッジ 605円(税込)（店舗）',
  '- キーホルダー 770円(税込)（店舗）',
  '',
  '## 作品 カフェ 10月16日より開催',
  '',
  '| 項目 | 内容 |',
  '|------|------|',
  '| 開催期間 | 2026年10月16日〜 |',
].join('\n');

/** 古い書式の記事 (品目は画像だけ) */
const legacy = [
  frontmatter(10),
  '## 作品 カフェ in 6都市のメニュー',
  '### メニューラインナップ',
  '![メニュー](https://example.com/m.jpg)',
  '### メニュー注文特典',
  '![特典](https://example.com/n.jpg)',
  '## 作品 カフェ in 6都市のノベルティー',
  '### ノベルティー',
  '![ノベルティ](https://example.com/n2.jpg)',
  '## 作品 カフェ in 6都市のグッズ',
  '### グッズラインナップ',
  '![グッズ](https://example.com/g.jpg)',
].join('\n');

describe('countArticleItems', () => {
  it('今の書式: 会場は occurrences、品目は見出しと箇条書き (構造の見出しと表の見出しの行は数えない)', () => {
    expect(countArticleItems(current)).toEqual({ venues: 4, menu: 3, goods: 2, novelty: 2 });
  });

  it('古い書式: 品目が画像だけなら 0', () => {
    expect(countArticleItems(legacy)).toEqual({ venues: 10, menu: 0, goods: 0, novelty: 0 });
  });

  it('event_data が無ければ会場は 0', () => {
    expect(countArticleItems(`${frontmatter(0)}\n## 作品のメニュー\n### パスタ\n`).venues).toBe(0);
  });

  it('同じ種類の節が 2 つあれば両方を数える', () => {
    const two = `${frontmatter(1)}\n## フードメニュー\n### パスタ\n### カレー\n## ドリンクメニュー\n### ソーダ\n## 作品のグッズ\n- 缶バッジ\n`;
    expect(countArticleItems(two)).toEqual({ venues: 1, menu: 3, goods: 1, novelty: 0 });
  });

  it('節が無ければ 0 (別の節の品目を数えない)', () => {
    const onlyMenu = `${frontmatter(1)}\n## 作品のメニュー\n### パスタ\n## 作品 開催概要\n- 箇条書き\n`;
    expect(countArticleItems(onlyMenu)).toEqual({ venues: 1, menu: 1, goods: 0, novelty: 0 });
  });
});

describe('countSectionItems', () => {
  it('メニューの表 (HTML) の行を数える', () => {
    const lines = [
      '<div className="article-table-scroll">',
      '<table>',
      '<thead><tr><th scope="col">キャラクター名</th><th scope="col">メニュー名(値段)</th></tr></thead>',
      '<tbody>',
      '<tr><th scope="row">キャラA</th><td>パスタ 2,090円</td></tr>',
      '<tr><th scope="row">その他</th><td>ドリンク</td></tr>',
      '</tbody>',
      '</table>',
      '</div>',
    ];
    expect(countSectionItems(lines)).toBe(2);
  });

  it('グッズの表 (Markdown) は見出しの行と区切りの行を除く', () => {
    const lines = [
      '### グッズ一覧',
      '| 品名 | 価格 | 販売 |',
      '|------|------|------|',
      '| 缶バッジ | 605円 | 店舗 |',
      '| 巾着 | | |',
      '| アクスタ | 990円 | 店舗 |',
    ];
    expect(countSectionItems(lines)).toBe(3);
  });

  it('表が 2 つあれば、それぞれの見出しの行を除く', () => {
    const lines = ['| 品名 | 価格 |', '|---|---|', '| A | 1円 |', '', '| 品名 | 価格 |', '|---|---|', '| B | 1円 |', '| C | 1円 |'];
    expect(countSectionItems(lines)).toBe(3);
  });

  it('名前が「特典」で終わるノベルティは品目として数える。注意書きの箇条書きは数えない', () => {
    expect(countSectionItems(['### 来店特典', '### ノベルティー', '- 缶バッジ', '- ※価格は税込'])).toBe(2);
  });

  it('品目ごとの形のグッズは見出しを数え、販売の行は数えない', () => {
    expect(countSectionItems(['### 缶バッジ 605円', '販売：店舗', '### 巾着', '### その他参考画像'])).toBe(2);
  });
});

describe('checkShrink', () => {
  const before: ArticleCounts = { venues: 4, menu: 19, goods: 7, novelty: 0 };

  it('減っていなければ shrunk は false (ノベルティは更新前が 0 なので比べない)', () => {
    const check = checkShrink(before, { venues: 4, menu: 20, goods: 7, novelty: 2 });
    expect(check.shrunk).toBe(false);
    expect(check.comparisons.find((c) => c.key === 'novelty')).toMatchObject({ comparable: false, shrunk: false });
  });

  it('1 つでも減れば shrunk', () => {
    const check = checkShrink(before, { venues: 3, menu: 19, goods: 7, novelty: 0 });
    expect(check.shrunk).toBe(true);
    expect(check.comparisons.filter((c) => c.shrunk).map((c) => c.key)).toEqual(['venues']);
  });

  it('数えられた項目が 0 になったら減ったとみなす', () => {
    expect(checkShrink(before, { venues: 4, menu: 19, goods: 0, novelty: 0 }).shrunk).toBe(true);
  });

  it('減っていれば PR を作らない理由を返し、--allow-shrink なら null (PR を作る)', () => {
    const check = checkShrink(before, { venues: 3, menu: 19, goods: 7, novelty: 0 });
    expect(shrinkStopMessage(check, false)).toContain('PR を作りませんでした (会場: 4 → 3 (減った))');
    expect(shrinkStopMessage(check, true)).toBeNull();
  });

  it('減っていなければ null', () => {
    expect(shrinkStopMessage(checkShrink(before, before), false)).toBeNull();
  });

  it('説明の行', () => {
    const check = checkShrink(before, { venues: 4, menu: 18, goods: 7, novelty: 2 });
    expect(describeShrinkCheck(check)).toEqual([
      '会場: 4 → 4',
      'メニュー: 19 → 18 (減った)',
      'グッズ: 7 → 7',
      'ノベルティ: 比べられない (更新前の記事で数が読めない。更新後 2)',
    ]);
  });
});
