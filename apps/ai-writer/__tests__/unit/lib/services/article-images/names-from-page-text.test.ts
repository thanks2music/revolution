/**
 * Layer 1: 代替テキストが品名でない画像に、ページの本文から品名を当てる (`names-from-page-text.ts`)
 */
import { describe, expect, it } from '@jest/globals';
import { nameFromPageText, withNamesFromPageText } from '@/lib/services/article-images/names-from-page-text';

const names = ['ホログラムステッカー', 'オリジナルコースター（全7種）', 'ヒーローカード（ランダム7種）'];

/** ヒロアカの会場のページの本文 (compactHtmlForLlm の出力の形。2026-10-24 のログから) */
const heroaca = [
  '<p><span>事前予約者限定カフェ利用特典</span>事前ご予約(税込715円/1名)のうえ、カフェにてメニューをご注文いただいたお客様に、「ホログラムステッカー」を1枚プレゼント！</p>',
  '[画像: 事前予約者限定カフェ利用特典]',
  '<p><span>ドリンク特典</span>対象ドリンクをご注文のお客様に、ご注文のキャラクターの「オリジナルコースター（全7種）」を1品につき1枚プレゼント！</p>',
  '[画像: ドリンク特典]',
  '<p><span>物販購入特典</span>カフェ店舗にて、グッズを1点以上ご購入のお客様に「ヒーローカード（ランダム7種）」をいずれか1枚プレゼント！</p>',
  '[画像: 物販購入特典]',
].join('\n');

describe('nameFromPageText', () => {
  it('代替テキストの見出しの後ろ、次の画像までにある品名を当てる (ヒロアカ)', () => {
    expect(nameFromPageText('事前予約者限定カフェ利用特典', names, [heroaca])).toBe('ホログラムステッカー');
    expect(nameFromPageText('ドリンク特典', names, [heroaca])).toBe('オリジナルコースター（全7種）');
    expect(nameFromPageText('物販購入特典', names, [heroaca])).toBe('ヒーローカード（ランダム7種）');
  });

  it('画像の印の中の代替テキストからは探さない (次の段落の品名を当てない)', () => {
    const text = '[画像: ドリンク特典]\n<p>「ヒーローカード（ランダム7種）」をプレゼント</p>';
    expect(nameFromPageText('ドリンク特典', names, [text])).toBeNull();
  });

  it('品名が 2 つ以上あれば当てない', () => {
    const text = '<p>来店特典「ホログラムステッカー」と「ヒーローカード（ランダム7種）」</p>\n[画像: 来店特典]';
    expect(nameFromPageText('来店特典', names, [text])).toBeNull();
  });

  it('ほかの品名に含まれる短い名前は候補から外す', () => {
    const text = '<p>来店特典「ホログラムステッカー」</p>\n[画像: 来店特典]';
    expect(nameFromPageText('来店特典', ['ステッカー', 'ホログラムステッカー'], [text])).toBe('ホログラムステッカー');
  });

  it('複数のページで別の品名が当たれば当てない。同じ品名なら当てる', () => {
    const a = '<p>特典「ホログラムステッカー」</p>[画像: 特典]';
    const b = '<p>特典「ヒーローカード（ランダム7種）」</p>[画像: 特典]';
    expect(nameFromPageText('特典', names, [a, b])).toBeNull();
    expect(nameFromPageText('特典', names, [a, a])).toBe('ホログラムステッカー');
  });

  it('本文に代替テキストが無ければ、空の代替テキストなら null', () => {
    expect(nameFromPageText('ノベルティ1', names, [heroaca])).toBeNull();
    expect(nameFromPageText(' ', names, [heroaca])).toBeNull();
  });
});

describe('withNamesFromPageText', () => {
  it('照合できない代替テキストだけを品名に置き換え、置き換えた数を返す', () => {
    const images = [
      { url: 'a', alt: '事前予約者限定カフェ利用特典' },
      { url: 'b', alt: 'ヒーローカード（ランダム7種）' },
      { url: 'c', alt: null },
      { url: 'd', alt: '不明な画像' },
    ];
    expect(withNamesFromPageText(names, images, [heroaca])).toEqual({
      images: [
        { url: 'a', alt: 'ホログラムステッカー' },
        { url: 'b', alt: 'ヒーローカード（ランダム7種）' },
        { url: 'c', alt: null },
        { url: 'd', alt: '不明な画像' },
      ],
      named: 1,
    });
  });
});
