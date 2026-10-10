import { describe, expect, it } from '@jest/globals';

import { enforceTitleCityLabel } from '@/lib/utils/enforce-title-city-label';

const enforce = (title: string, label: string | undefined) => enforceTitleCityLabel(title, label, 40);

describe('enforceTitleCityLabel', () => {
  // 2026-10-10 heroaca-cafe の実測。確定値は 4 都市を丸めた `4都市` で、宮城は入力のどこにも無い
  it('丸めた N都市 を LLM が都市一覧に展開したら確定値へ戻す', () => {
    expect(
      enforce('ヒロアカ カフェ in 東京/大阪/名古屋/宮城 10月16日よりコラボ開催', '4都市')
    ).toBe('ヒロアカ カフェ in 4都市 10月16日よりコラボ開催');
  });

  it('都市一覧から都市が欠けていたら確定値へ戻す', () => {
    expect(enforce('初音ミク カフェ in 東京/大阪 8月7日よりコラボ開催', '東京/愛知/大阪')).toBe(
      '初音ミク カフェ in 東京/愛知/大阪 8月7日よりコラボ開催'
    );
  });

  it('N都市 の数が違えば確定値へ戻す', () => {
    expect(enforce('名探偵コナン カフェ in 5都市 4月10日よりコラボ開催', '6都市')).toBe(
      '名探偵コナン カフェ in 6都市 4月10日よりコラボ開催'
    );
  });

  it('確定値どおりなら変えない', () => {
    const title = '名探偵コナン カフェ in 6都市 4月10日よりコラボ開催';
    expect(enforce(title, '6都市')).toBe(title);
  });

  it('in の後ろが店舗名の型のタイトルには触れない', () => {
    const title = 'トイ・ストーリー5 カフェ in OH MY CAFE 7月3日よりコラボ開催';
    expect(enforce(title, '東京/大阪')).toBe(title);
  });

  it('in が 2 回あるときは最初の in だけを見る (店舗名の型なら後ろの in にも触れない)', () => {
    const title = 'トイ・ストーリー5 カフェ in OH MY CAFE in 東京/宮城 7月3日より開催';
    expect(enforce(title, '東京/大阪')).toBe(title);
  });

  it('in が 2 回あり最初の in が都市の一覧なら、そこだけを置き換える', () => {
    expect(enforce('ヒロアカ カフェ in 東京/宮城 in 2026 10月16日より開催', '東京/大阪')).toBe(
      'ヒロアカ カフェ in 東京/大阪 in 2026 10月16日より開催'
    );
  });

  it('in を使わないタイトルには触れない', () => {
    const title = '名探偵コナン 6都市 4月10日よりコラボ開催';
    expect(enforce(title, '6都市')).toBe(title);
  });

  it('確定値が無ければ何もしない', () => {
    const title = 'ヒロアカ カフェ in 東京/大阪 10月16日よりコラボ開催';
    expect(enforce(title, undefined)).toBe(title);
  });

  it('本文と同じ「・」区切りで並べた一覧も確定値へ戻す', () => {
    expect(enforce('ヒロアカ カフェ in 東京・大阪・名古屋・宮城 10月16日より開催', '4都市')).toBe(
      'ヒロアカ カフェ in 4都市 10月16日より開催'
    );
  });

  it('タイトルの末尾にある開催地も対象にする', () => {
    expect(enforce('ヒロアカ カフェ in 東京/大阪/名古屋/宮城', '4都市')).toBe('ヒロアカ カフェ in 4都市');
  });

  it('都市の数が合っている N都市 は、LLM が丸めた正しい表記として残す', () => {
    const title = '僕のヒーローアカデミア カフェ in 3都市 10月16日よりコラボ開催';
    expect(enforce(title, '東京/愛知/大阪')).toBe(title);
  });

  it('確定値に置き換えると上限を超える場合は N都市 にする', () => {
    // 確定値 (東京/愛知/大阪) に置き換えると 50 字になり、上限の 40 を超える
    const title = 'ヒロアカ WE ARE HERO HOLICS カフェ in 東京/宮城 10月16日より開催';
    expect(enforce(title, '東京/愛知/大阪')).toBe('ヒロアカ WE ARE HERO HOLICS カフェ in 3都市 10月16日より開催');
  });
});
