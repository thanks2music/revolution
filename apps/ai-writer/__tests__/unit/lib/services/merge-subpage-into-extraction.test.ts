/**
 * Layer 1: 下層ページの抽出結果をトップページの抽出結果に合わせる `mergeSubpagesIntoExtraction` (2026-10-12 の方針)。
 */
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import { mergeSubpagesIntoExtraction } from '@/lib/services/merge-subpage-into-extraction';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';
import type { SubpageGoodsItem } from '@revolution/schemas/subpage-extraction-response';

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    作品名: '名探偵コナン',
    キャラクター名: null,
    メニュー詳細リスト: null,
    具体的なメニュー名リスト: null,
    グッズ名: null,
    ノベルティ名: null,
    ...overrides,
  } as ExtractionResult;
}

function item(name: string, price: string | null = null, character: string | null = null): ExtractionMenuItem {
  return { character, name, price, imageUrl: null, copyright: null };
}

function page(overrides: Partial<SubpageFacts> & Pick<SubpageFacts, 'kind'>): SubpageFacts {
  return {
    url: `https://example.com/${overrides.kind}`,
    area: null,
    メニュー詳細リスト: null,
    グッズ詳細リスト: null,
    ノベルティ名: null,
    キャラクター名: null,
    ...overrides,
  };
}

describe('メニュー', () => {
  it('下層ページの一覧を正とし、トップにしか無い品目は後ろに足す (コナン: トップ 5 品、メニューページ 27 品)', () => {
    const { extraction: merged, changes } = mergeSubpagesIntoExtraction(
      extraction({
        メニュー詳細リスト: [item('“風の”ビーフシチューハンバーグ', '2,190円(税込)'), item('江戸川コナンのショートケーキ')],
      }),
      [
        page({
          kind: 'menu',
          メニュー詳細リスト: [item('江戸川コナンのショートケーキ', '1,590円(税込)', '江戸川コナン'), item('松田陣平の林檎エード')],
        }),
      ]
    );

    expect(merged.メニュー詳細リスト?.map((m) => [m.name, m.price])).toEqual([
      ['江戸川コナンのショートケーキ', '1,590円(税込)'], // 下層の値を使う
      ['松田陣平の林檎エード', null],
      ['“風の”ビーフシチューハンバーグ', '2,190円(税込)'], // トップにしか無い品目
    ]);
    expect(changes[0]).toContain('下層ページの 2 品');
  });

  it('メニューのページを先に並べ、ページをまたいだ重複は除く', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [
      page({ kind: 'venue', メニュー詳細リスト: [item('マルゲリータ'), item('限定ドリンク')] }),
      page({ kind: 'menu', メニュー詳細リスト: [item('マルゲリータ'), item('チリトマト')] }),
    ]);

    expect(merged.メニュー詳細リスト?.map((m) => m.name)).toEqual(['マルゲリータ', 'チリトマト', '限定ドリンク']);
  });

  it('下層ページに品目が無ければトップのまま', () => {
    const top = [item('マルゲリータ')];
    const { extraction: merged, changes } = mergeSubpagesIntoExtraction(extraction({ メニュー詳細リスト: top }), [
      page({ kind: 'menu' }),
    ]);

    expect(merged.メニュー詳細リスト).toBe(top);
    expect(changes).toEqual([]);
  });
});

describe('グッズ', () => {
  const goods = (name: string, price: string | null, sales: SubpageGoodsItem['sales']): SubpageGoodsItem => ({
    name,
    price,
    sales,
  });

  it('下層ページの品目を正とし、会場で買えるものだけをグッズ名にする (オンライン限定は除く)', () => {
    const { extraction: merged, changes } = mergeSubpagesIntoExtraction(extraction({ グッズ名: ['缶バッジ', 'クッキー缶'] }), [
      page({
        kind: 'goods',
        グッズ詳細リスト: [
          goods('缶バッジ レトロver.（ランダム12種）', '605円(税込)', 'store_and_online'),
          goods('缶バッジ レトロver.（全12種）コンプリートセット', '7,260円(税込)', 'online_only'),
          goods('サイダー', '972円(税込)', 'store_only'),
        ],
      }),
    ]);

    expect(merged.グッズ名).toEqual(['缶バッジ レトロver.（ランダム12種）', 'サイダー', '缶バッジ', 'クッキー缶']);
    expect(merged.グッズ詳細リスト).toHaveLength(3);
    expect(changes[0]).toContain('うちオンライン限定 1 件');
  });

  it('トップの名前がオンライン限定の品目と同じなら足さない', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction({ グッズ名: ['限定セット（全1種）'] }), [
      page({ kind: 'goods', グッズ詳細リスト: [goods('限定セット', null, 'online_only'), goods('缶バッジ', null, 'store')] }),
    ]);

    expect(merged.グッズ名).toEqual(['缶バッジ']);
  });

  it('同じ商品が複数のページにあれば、欠けている価格や販売方法を補い、種類数の付いた名前を残す', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [
      page({ kind: 'menu', グッズ詳細リスト: [goods('プレート', '1,650円(税込)', null)] }),
      page({ kind: 'goods', グッズ詳細リスト: [goods('プレート（全1種）', null, 'store')] }),
    ]);

    expect(merged.グッズ詳細リスト).toEqual([goods('プレート（全1種）', '1,650円(税込)', 'store')]);
  });
});

describe('キャラクター名', () => {
  it('トップを先に、下層ページの新しい名前を後ろに足す (表記の揺れは同じとみなす)', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction({ キャラクター名: ['緑谷出久'] }), [
      page({ kind: 'goods', キャラクター名: ['緑谷 出久', '爆豪勝己'] }),
    ]);

    expect(merged.キャラクター名).toEqual(['緑谷出久', '爆豪勝己']);
  });
});

describe('ノベルティ名', () => {
  const venue = (area: string | null, novelties: string[]) =>
    page({ kind: 'venue', url: `https://example.com/${area}`, area, ノベルティ名: novelties });

  it('全会場に共通のノベルティは名前だけを書く (ヒロアカ: 4 会場とも同じ 3 種類)', () => {
    const names = ['ホログラムステッカー', 'オリジナルコースター（全7種）', 'ヒーローカード（ランダム7種）'];
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [
      venue('東京', names),
      venue('愛知', names),
      venue('大阪', names),
      venue('北海道', names),
    ]);

    expect(merged.ノベルティ名).toEqual(names);
  });

  it('一部の会場にしか無いノベルティには会場を付ける (配布条件は付けない)', () => {
    const { extraction: merged, changes } = mergeSubpagesIntoExtraction(extraction(), [
      venue('東京', ['ステッカー']),
      venue('大阪', ['ステッカー', 'アクリルカード']),
      venue('名古屋', ['ステッカー', 'アクリルカード']),
    ]);

    expect(merged.ノベルティ名).toEqual(['ステッカー', 'アクリルカード（大阪・名古屋会場のみ）']);
    expect(changes.join()).toContain('会場限定 1 件');
  });

  it('会場の地域名が読み取れなかったら、限定と書かずに名前だけにする (推測しない)', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [
      venue('東京', ['ステッカー']),
      venue(null, ['ステッカー', 'アクリルカード']),
    ]);

    expect(merged.ノベルティ名).toEqual(['ステッカー', 'アクリルカード']);
  });

  it('ノベルティが読めない会場のページがあれば、限定とは書かない (その会場に無いとは言い切れない)', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [
      venue('東京', ['ステッカー', 'アクリルカード']),
      venue('神奈川', ['ステッカー', 'アクリルカード']),
      venue('愛知', []), // 本文が切り詰められた、お知らせの記事だった、など
    ]);

    expect(merged.ノベルティ名).toEqual(['ステッカー', 'アクリルカード']);
  });

  it('会場のページが 1 つだけなら、限定かどうかは分からないので名前だけにする', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction(), [venue('東京', ['ステッカー'])]);

    expect(merged.ノベルティ名).toEqual(['ステッカー']);
  });

  it('トップが限定と書かずに挙げたノベルティも、会場のページで限定と分かれば会場を付ける', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction({ ノベルティ名: ['ステッカー', 'アクリルカード'] }), [
      venue('東京', ['ステッカー']),
      venue('大阪', ['ステッカー', 'アクリルカード']),
    ]);

    expect(merged.ノベルティ名).toEqual(['ステッカー', 'アクリルカード（大阪会場のみ）']);
  });

  it('種類数の注記の有無だけが違う名前は 1 つにし、注記の付いた方を残す', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(
      extraction({ ノベルティ名: ['カラビナ付きクリアポーチ', 'オリジナルクリアケース'] }),
      [page({ kind: 'novelty', ノベルティ名: ['カラビナ付きクリアポーチ（全1種）', 'オリジナルクリアケース (全1種)'] })]
    );

    expect(merged.ノベルティ名).toEqual(['カラビナ付きクリアポーチ（全1種）', 'オリジナルクリアケース (全1種)']);
  });

  it('下層ページからノベルティが読めたら下層だけを使い、トップの名前は使わない (トップの紹介文は特典か見分けにくい)', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(
      extraction({ ノベルティ名: ['アクリルキーホルダー', 'カラビナ付きクリアポーチ'] }), // 有料プランに付く物
      [page({ kind: 'novelty', ノベルティ名: ['招待状（ランダム7種）', 'ナゾトキブック（全1種）'] })]
    );

    expect(merged.ノベルティ名).toEqual(['招待状（ランダム7種）', 'ナゾトキブック（全1種）']);
  });

  it('下層ページから読めなければトップの名前のまま (下層を持たないサイト)', () => {
    const top = ['コースター'];
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction({ ノベルティ名: top }), [
      page({ kind: 'menu', メニュー詳細リスト: [item('パフェ')] }),
    ]);

    expect(merged.ノベルティ名).toEqual(top);
  });

  it('ノベルティのページ (会場以外) の名前はそのまま足す', () => {
    const { extraction: merged } = mergeSubpagesIntoExtraction(extraction({ ノベルティ名: ['コースター'] }), [
      page({ kind: 'novelty', ノベルティ名: ['コースター', 'ランチョンマット'] }),
    ]);

    expect(merged.ノベルティ名).toEqual(['コースター', 'ランチョンマット']);
  });
});

it('何も読めなければ抽出結果をそのまま返す', () => {
  const base = extraction({ キャラクター名: ['緑谷出久'] });
  const result = mergeSubpagesIntoExtraction(base, [page({ kind: 'menu' }), page({ kind: 'venue' })]);

  expect(result.extraction).toBe(base);
  expect(result.changes).toEqual([]);
});
