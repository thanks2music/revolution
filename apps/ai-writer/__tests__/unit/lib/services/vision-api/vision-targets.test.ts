/**
 * Layer 1: HTML から書けなかった項目のカテゴリだけを Vision で読む `determineVisionTargets`。
 */
import { determineVisionTargets } from '@/lib/services/vision-api/vision-targets';

const full = {
  キャラクター名: ['江戸川コナン'],
  メニュー詳細リスト: [{ character: null, name: 'ナポリタン', price: '1,590円(税込)', imageUrl: null, copyright: null }],
  具体的なメニュー名リスト: ['ナポリタン'],
  グッズ名: ['缶バッジ'],
  ノベルティ名: ['アクリルキーホルダー'],
};

describe('determineVisionTargets', () => {
  it('4 項目とも HTML で書ければ何も読まない', () => {
    expect(determineVisionTargets(full)).toEqual({ missingFields: [], categories: [] });
  });

  it('欠けた項目のカテゴリだけを読む', () => {
    expect(determineVisionTargets({ ...full, ノベルティ名: null })).toEqual({
      missingFields: ['ノベルティ名'],
      categories: ['novelty'],
    });
    expect(determineVisionTargets({ ...full, グッズ名: [] })).toEqual({
      missingFields: ['グッズ名'],
      categories: ['goods'],
    });
  });

  it('メニュー名は、詳細リストと名前の一覧の両方が無いときだけ欠けとみなす', () => {
    expect(determineVisionTargets({ ...full, メニュー詳細リスト: null }).categories).toEqual([]);
    expect(
      determineVisionTargets({ ...full, メニュー詳細リスト: null, 具体的なメニュー名リスト: null })
    ).toEqual({ missingFields: ['メニュー名'], categories: ['menu'] });
  });

  it('キャラクター名が無いときは、メニューとグッズの両方を読む', () => {
    expect(determineVisionTargets({ ...full, キャラクター名: null })).toEqual({
      missingFields: ['キャラクター名'],
      categories: ['menu', 'goods'],
    });
  });

  it('全部欠けていれば 3 カテゴリとも読む (順は menu → goods → novelty)', () => {
    expect(
      determineVisionTargets({
        キャラクター名: null,
        メニュー詳細リスト: null,
        具体的なメニュー名リスト: null,
        グッズ名: null,
        ノベルティ名: null,
      })
    ).toEqual({
      missingFields: ['キャラクター名', 'メニュー名', 'グッズ名', 'ノベルティ名'],
      categories: ['menu', 'goods', 'novelty'],
    });
  });
});
