/**
 * Layer 1: Vision の結果で抽出結果の欠けを埋める `mergeVisionIntoExtraction` (2026-10-11 の方針)。
 */
import type { ExtractionResult } from '@/lib/services/extraction.service';
import {
  formatPrice,
  mergeVisionIntoExtraction,
  normalizeMenuName,
} from '@/lib/services/vision-api/merge-vision-into-extraction';
import { mentionsRedrawnIllustration } from '@/lib/utils/redrawn-illustration';
import type { MenuItem, VisionExtractionResult } from '@/lib/types/vision-api';

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    作品名: '名探偵コナン',
    店舗名: 'コナンカフェ',
    キャラクター名: null,
    メニュー詳細リスト: null,
    具体的なメニュー名リスト: null,
    グッズ名: null,
    ノベルティ名: null,
    ...overrides,
  } as ExtractionResult;
}

function menu(name: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return { name, characterName: [], hasNovelty: false, ...overrides };
}

function vision(
  overrides: Partial<VisionExtractionResult['visionExtraction']> = {}
): VisionExtractionResult['visionExtraction'] {
  return {
    confidence: 0.9,
    provider: 'google',
    timestamp: '2026-10-12T00:00:00.000Z',
    menuItems: [],
    goodsItems: [],
    noveltyItems: [],
    ...overrides,
  };
}

const noRedrawn = { hasRedrawnIllustrations: false };

describe('formatPrice', () => {
  it('税込・税抜が読めたら付け、読めなければ金額だけにする', () => {
    expect(formatPrice(2090, 'included')).toBe('2,090円(税込)');
    expect(formatPrice(1900, 'excluded')).toBe('1,900円(税抜)');
    expect(formatPrice(1000)).toBe('1,000円');
  });
});

describe('normalizeMenuName', () => {
  it('引用符・空白・全角半角の違いを無視する', () => {
    expect(normalizeMenuName('“風の”ビーフシチュー ハンバーグ')).toBe(normalizeMenuName('風のビーフシチューハンバーグ'));
    expect(normalizeMenuName('ＡＢＣパフェ')).toBe(normalizeMenuName('abcパフェ'));
  });
});

describe('mentionsRedrawnIllustration', () => {
  it('どれかのページに「描き下ろし」「描き起こし」(ひらがな表記を含む) があれば true', () => {
    expect(mentionsRedrawnIllustration([undefined, '<p>描き下ろしイラスト</p>'])).toBe(true);
    expect(mentionsRedrawnIllustration(['描き起こしビジュアル'])).toBe(true);
    expect(mentionsRedrawnIllustration(['描きおろし'])).toBe(true);
    expect(mentionsRedrawnIllustration(['公式イラスト', null])).toBe(false);
  });
});

describe('mergeVisionIntoExtraction: メニュー', () => {
  it('HTML に品目が無ければ Vision の一覧を全品使う (価格の無い品目も載せる)', () => {
    const { extraction: merged, changes } = mergeVisionIntoExtraction(
      extraction(),
      vision({
        menuItems: [
          menu('パフェ', { price: 1200, priceTaxType: 'included', characterName: ['デク', '爆豪'] }),
          menu('ドリンク'),
        ],
      }),
      noRedrawn
    );

    expect(merged.メニュー詳細リスト).toEqual([
      { character: 'デク、爆豪', name: 'パフェ', price: '1,200円(税込)', imageUrl: null, copyright: null },
      { character: null, name: 'ドリンク', price: null, imageUrl: null, copyright: null },
    ]);
    expect(merged.具体的なメニュー名リスト).toEqual(['パフェ', 'ドリンク']);
    expect(changes[0]).toContain('Vision の 2 品');
  });

  it('HTML に品目があれば HTML の一覧だけを使い、名前が一致した品目の空欄だけを埋める', () => {
    const html = extraction({
      メニュー詳細リスト: [
        { character: null, name: '“風の”ビーフシチューハンバーグ', price: null, imageUrl: null, copyright: null },
        { character: '江戸川コナン', name: 'ショートケーキ', price: '1,590円(税込)', imageUrl: null, copyright: null },
      ],
    });

    const { extraction: merged } = mergeVisionIntoExtraction(
      html,
      vision({
        menuItems: [
          menu('風のビーフシチューハンバーグ', { price: 2190, characterName: ['毛利蘭'] }),
          menu('ショートケーキ', { price: 9999, characterName: ['安室透'] }),
          menu('Vision だけの品目', { price: 500 }),
        ],
      }),
      noRedrawn
    );

    expect(merged.メニュー詳細リスト).toEqual([
      { character: '毛利蘭', name: '“風の”ビーフシチューハンバーグ', price: '2,190円', imageUrl: null, copyright: null },
      // HTML に値がある欄は上書きしない
      { character: '江戸川コナン', name: 'ショートケーキ', price: '1,590円(税込)', imageUrl: null, copyright: null },
    ]);
  });

  it('Vision がキャラクター名を含めて読んだ品目も、HTML の名前を含んでいれば照合する', () => {
    // 2-extraction は【キャラ】を character に分け、Vision は name にキャラクター名を含める
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({
        メニュー詳細リスト: [
          { character: '五条悟', name: '唯我独尊フルーツサンド', price: null, imageUrl: null, copyright: null },
        ],
      }),
      vision({ menuItems: [menu('五条悟の唯我独尊フルーツサンド', { price: 1650, priceTaxType: 'included' })] }),
      noRedrawn
    );

    expect(merged.メニュー詳細リスト?.[0].price).toBe('1,650円(税込)');
  });

  it('候補が 1 つに決まらないときは埋めない (同名の品目・短い名前の部分一致)', () => {
    const html = extraction({
      メニュー詳細リスト: [
        { character: null, name: 'コラボドリンク', price: null, imageUrl: null, copyright: null },
        { character: null, name: 'パフェ', price: null, imageUrl: null, copyright: null },
      ],
    });

    const { extraction: merged, changes } = mergeVisionIntoExtraction(
      html,
      vision({
        menuItems: [
          menu('コラボドリンク', { price: 800, characterName: ['狗巻棘'] }),
          menu('コラボドリンク', { price: 700, characterName: ['五条悟'] }),
          menu('五条悟のパフェ', { price: 1500 }),
        ],
      }),
      noRedrawn
    );

    expect(merged.メニュー詳細リスト).toBe(html.メニュー詳細リスト);
    expect(changes.some((c) => c.startsWith('メニュー'))).toBe(false);
  });

  it('HTML に名前の一覧だけがあるときも、Vision の品目は足さない', () => {
    const { extraction: merged, changes } = mergeVisionIntoExtraction(
      extraction({ 具体的なメニュー名リスト: ['ナポリタン'] }),
      vision({ menuItems: [menu('ナポリタン', { price: 1500 }), menu('パフェ')] }),
      noRedrawn
    );

    expect(merged.メニュー詳細リスト).toEqual([
      { character: null, name: 'ナポリタン', price: '1,500円', imageUrl: null, copyright: null },
    ]);
    expect(changes[0]).toContain('1 品の空欄');
  });

  it('メニュー種類数は作らない (一覧が一部だけのことがあるため)', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({ メニュー種類数: null }),
      vision({ menuItems: [menu('A'), menu('B')] }),
      noRedrawn
    );

    expect(merged.メニュー種類数).toBeNull();
  });
});

describe('mergeVisionIntoExtraction: グッズ名・ノベルティ名', () => {
  it('HTML が空のときだけ Vision の名前を使う (重複を除く)', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({ グッズ名: ['アクリルスタンド'] }),
      vision({
        goodsItems: [{ name: '缶バッジ', characterName: [], isRandomSale: true }],
        noveltyItems: [
          { name: 'ステッカー', characterName: [], isRandom: true },
          { name: 'ステッカー', characterName: [], isRandom: true },
        ],
      }),
      noRedrawn
    );

    expect(merged.グッズ名).toEqual(['アクリルスタンド']);
    expect(merged.ノベルティ名).toEqual(['ステッカー']);
  });
});

describe('mergeVisionIntoExtraction: キャラクター名', () => {
  const withCharacters = vision({
    menuItems: [menu('パフェ', { characterName: ['デク', '爆豪'] })],
    goodsItems: [{ name: '缶バッジ', characterName: ['轟', 'デク'], isRandomSale: false }],
  });

  it('描き下ろしの記載があれば Vision と HTML を合わせる (Vision を先、重複を除く)', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({ キャラクター名: ['オールマイト', 'デク'] }),
      withCharacters,
      { hasRedrawnIllustrations: true }
    );

    expect(merged.キャラクター名).toEqual(['デク', '爆豪', '轟', 'オールマイト']);
  });

  it('描き下ろしで合わせるとき、同じ人物の表記ゆれは HTML (公式) の表記にまとめる', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({ キャラクター名: ['虎杖悠仁', '五条 悟'] }),
      vision({ menuItems: [menu('パフェ', { characterName: ['虎杖', '五条悟', '伏黒恵'] })] }),
      { hasRedrawnIllustrations: true }
    );

    expect(merged.キャラクター名).toEqual(['虎杖悠仁', '五条 悟', '伏黒恵']);
  });

  it('描き下ろしの記載が無ければ、HTML にあるときは変えない', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(
      extraction({ キャラクター名: ['オールマイト'] }),
      withCharacters,
      noRedrawn
    );

    expect(merged.キャラクター名).toEqual(['オールマイト']);
  });

  it('描き下ろしの記載が無くても、HTML が空なら Vision を使う', () => {
    const { extraction: merged } = mergeVisionIntoExtraction(extraction(), withCharacters, noRedrawn);

    expect(merged.キャラクター名).toEqual(['デク', '爆豪', '轟']);
  });
});

describe('mergeVisionIntoExtraction: 何も埋めないとき', () => {
  it('入力をそのまま返し、変更の一覧は空', () => {
    const input = extraction({ キャラクター名: ['デク'], グッズ名: ['缶バッジ'], ノベルティ名: ['カード'] });

    const result = mergeVisionIntoExtraction(input, vision(), noRedrawn);

    expect(result.extraction).toBe(input);
    expect(result.changes).toEqual([]);
  });
});
