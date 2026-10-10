import { describe, expect, it } from '@jest/globals';

import { enforceTitleCityLabel } from '@/lib/utils/enforce-title-city-label';

describe('enforceTitleCityLabel', () => {
  // 2026-10-10 heroaca-cafe の実測。確定値は 4 都市を丸めた `4都市` で、宮城は入力のどこにも無い
  it('丸めた N都市 を LLM が都市一覧に展開したら確定値へ戻す', () => {
    expect(
      enforceTitleCityLabel('ヒロアカ カフェ in 東京/大阪/名古屋/宮城 10月16日よりコラボ開催', '4都市')
    ).toBe('ヒロアカ カフェ in 4都市 10月16日よりコラボ開催');
  });

  it('都市一覧から都市が欠けていたら確定値へ戻す', () => {
    expect(enforceTitleCityLabel('初音ミク カフェ in 東京/大阪 8月7日よりコラボ開催', '東京/愛知/大阪')).toBe(
      '初音ミク カフェ in 東京/愛知/大阪 8月7日よりコラボ開催'
    );
  });

  it('N都市 の数が違えば確定値へ戻す', () => {
    expect(enforceTitleCityLabel('名探偵コナン カフェ in 5都市 4月10日よりコラボ開催', '6都市')).toBe(
      '名探偵コナン カフェ in 6都市 4月10日よりコラボ開催'
    );
  });

  it('確定値どおりなら変えない', () => {
    const title = '名探偵コナン カフェ in 6都市 4月10日よりコラボ開催';
    expect(enforceTitleCityLabel(title, '6都市')).toBe(title);
  });

  it('in の後ろが店舗名の型のタイトルには触れない', () => {
    const title = 'トイ・ストーリー5 カフェ in OH MY CAFE 7月3日よりコラボ開催';
    expect(enforceTitleCityLabel(title, '東京/大阪')).toBe(title);
  });

  it('in を使わないタイトルには触れない', () => {
    const title = '名探偵コナン 6都市 4月10日よりコラボ開催';
    expect(enforceTitleCityLabel(title, '6都市')).toBe(title);
  });

  it('確定値が無ければ何もしない', () => {
    const title = 'ヒロアカ カフェ in 東京/大阪 10月16日よりコラボ開催';
    expect(enforceTitleCityLabel(title, undefined)).toBe(title);
  });
});
