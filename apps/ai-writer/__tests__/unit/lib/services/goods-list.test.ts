/**
 * Layer 1: グッズの一覧と、本文の文に並べるグッズ名 (`goods-list.ts`、2026-10-12)。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SubpageGoodsItem } from '@revolution/schemas/subpage-extraction-response';
import {
  goodsNamesForProse,
  insertIntoGoodsSection,
  loadGoodsListConfig,
  renderGoodsList,
  type GoodsListConfig,
} from '@/lib/services/goods-list';

/** Templates の sections/04-goods.yaml の goods_list と同じ形 */
const CONFIG: GoodsListConfig = {
  prose_limit: 5,
  list_max_items: 3,
  heading: '### グッズ一覧',
  bullet: '- {{name}}{{#if price}} {{price}}{{/if}}{{#if sales}}（{{sales}}）{{/if}}',
  table_header: '| 品名 | 価格 | 販売 |',
  table_divider: '|------|------|------|',
  table_row: '| {{name}} | {{price}} | {{sales}} |',
  sales_labels: { store: '店舗', store_and_online: '店舗・オンライン', store_only: '店舗限定' },
  online_only_note: 'このほか、オンライン限定のグッズも販売される。',
};

const goods = (name: string, price: string | null, sales: SubpageGoodsItem['sales']): SubpageGoodsItem => ({
  name,
  price,
  sales,
});

describe('goodsNamesForProse', () => {
  it('文に並べるのは先頭の prose_limit 件まで', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(goodsNamesForProse(names, CONFIG)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(goodsNamesForProse(null, CONFIG)).toBeNull();
  });
});

describe('renderGoodsList', () => {
  it('list_max_items 件までは箇条書き。価格・販売方法が分からなければ書かない', () => {
    expect(
      renderGoodsList(['缶バッジ', 'サイダー'], [goods('缶バッジ', '605円(税込)', 'store_and_online')], CONFIG)
    ).toBe(['### グッズ一覧', '', '- 缶バッジ 605円(税込)（店舗・オンライン）', '- サイダー'].join('\n'));
  });

  it('それより多ければ表にし、セルの | は全角にする', () => {
    const text = renderGoodsList(
      ['A|B', 'C', 'D', 'E'],
      [goods('A|B', '100円', 'store'), goods('E', null, 'store_only')],
      CONFIG
    );

    expect(text.split('\n')).toEqual([
      '### グッズ一覧',
      '',
      '| 品名 | 価格 | 販売 |',
      '|------|------|------|',
      '| A｜B | 100円 | 店舗 |',
      '| C |  |  |',
      '| D |  |  |',
      '| E |  | 店舗限定 |',
    ]);
  });

  it('オンライン限定のグッズがあれば、品名は並べずに 1 文だけ書く', () => {
    const text = renderGoodsList(
      ['缶バッジ'],
      [goods('缶バッジ', null, 'store'), goods('コンプリートセット', '7,260円(税込)', 'online_only')],
      CONFIG
    );

    expect(text).toBe(['### グッズ一覧', '', '- 缶バッジ（店舗）', '', 'このほか、オンライン限定のグッズも販売される。'].join('\n'));
    expect(text).not.toContain('コンプリートセット');
  });

  it('品名の { } < > は MDX の式・JSX として評価されないよう文字参照にする', () => {
    expect(renderGoodsList(['{alert(1)}<script>'], [], CONFIG)).toContain('- &#123;alert(1)&#125;&#60;script&#62;');
  });

  it('グッズ名もオンライン限定も無ければ空', () => {
    expect(renderGoodsList(null, null, CONFIG)).toBe('');
  });
});

describe('insertIntoGoodsSection', () => {
  const ARTICLE = [
    '## カフェのメニュー',
    '',
    'メニュー',
    '',
    '## カフェのグッズ',
    '',
    '導入文',
    '',
    '![グッズ1](https://example.com/1.jpg)',
    '',
    '## まとめ',
    '',
    '表',
  ].join('\n');

  it('グッズの節の末尾 (次の ## の前) に差し込む', () => {
    expect(insertIntoGoodsSection(ARTICLE, '### グッズ一覧\n\n- 缶バッジ')).toBe(
      ARTICLE.replace('![グッズ1](https://example.com/1.jpg)\n\n## まとめ', '![グッズ1](https://example.com/1.jpg)\n\n### グッズ一覧\n\n- 缶バッジ\n\n## まとめ')
    );
  });

  it('グッズの節が記事の最後なら末尾に足す', () => {
    expect(insertIntoGoodsSection('## カフェのグッズ\n\n導入文\n', '- 缶バッジ')).toBe('## カフェのグッズ\n\n導入文\n\n- 缶バッジ\n');
  });

  it('グッズの節が無い、または差し込むものが無ければそのまま', () => {
    expect(insertIntoGoodsSection('## まとめ\n', '- 缶バッジ')).toBe('## まとめ\n');
    expect(insertIntoGoodsSection(ARTICLE, '')).toBe(ARTICLE);
  });
});

describe('loadGoodsListConfig', () => {
  it('04-goods.yaml の goods_list を読み、無ければ同期を促して止まる', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goods-list-'));
    const missing = path.join(dir, 'missing.yaml');
    fs.writeFileSync(missing, 'section:\n  id: goods\n');

    expect(() => loadGoodsListConfig(missing)).toThrow(/sync:templates/);
  });
});
