import { describe, expect, it } from '@jest/globals';

import { getShortTitle } from '@/lib/config/slug-resolver';

/**
 * `getShortTitle` の最長前方一致 (S1-d Phase 3、2026-08-09)
 *
 * 完全一致・alias 一致はどちらも完全一致しか見ないため、抽出された作品名に
 * 副題が付いていると一生ヒットしなかった。実測で
 *   「スター・ウォーズ／マンダロリアン・アンド・グローグー」(25 字)
 *   「Nissy Birthday Entertainment 2026」(33 字)
 * が辞書に当たらず、記事タイトルが 48 / 56 字に膨らんで**開催地が削られていた**。
 *
 * ★ 本テストは実辞書 (`title-romaji-mapping.yaml`) を読む。fixture を作ると
 *   「辞書に実際どう入っているか」を検証できないため。
 */
describe('getShortTitle — 最長前方一致', () => {
  describe('副題付きの作品名を拾う', () => {
    it('★ スター・ウォーズ／マンダロリアン・アンド・グローグー → スター・ウォーズ', () => {
      expect(getShortTitle('スター・ウォーズ／マンダロリアン・アンド・グローグー')).toBe('スター・ウォーズ');
    });

    it('★ Nissy Birthday Entertainment 2026 → Nissy (境界は半角空白)', () => {
      expect(getShortTitle('Nissy Birthday Entertainment 2026')).toBe('Nissy');
    });

    it('続編番号も境界として扱う (トイ・ストーリー5 → トイ・ストーリー)', () => {
      expect(getShortTitle('トイ・ストーリー5')).toBe('トイ・ストーリー');
    });
  });

  describe('記号がタイトルの一部である作品を壊さない', () => {
    // BOSS 懸念 (2026-08-09): 記号入りタイトルが途中で切られないか
    it('Fate/stay night は完全一致が優先される (「/」で切らない)', () => {
      expect(getShortTitle('Fate/stay night')).toBe('Fate');
    });

    it('Re:ゼロから始める異世界生活 は「:」で切られない', () => {
      // short_title = リゼロ。前方一致で「Re」等に切られていないことを示す
      expect(getShortTitle('Re:ゼロから始める異世界生活')).toBe('リゼロ');
    });

    it('「・」を境界にしない (作品名の内部に出るため)', () => {
      // 「ヴァイオレット・エヴァーガーデン」が「ヴァイオレット」で切られて
      // 別解釈されない = 完全一致が効いている
      expect(getShortTitle('ヴァイオレット・エヴァーガーデン')).toBe('ヴァイオレット');
    });

    it('「-」を境界にしない (PSYCHO-PASS / マッシュル-MASHLE-)', () => {
      expect(getShortTitle('PSYCHO-PASS')).toBe('サイコパス');
      expect(getShortTitle('マッシュル-MASHLE-')).toBe('マッシュル');
    });
  });

  describe('最長一致を採る', () => {
    it('機動戦士ガンダム 水星の魔女 は短い「機動戦士ガンダム」に落ちない', () => {
      // 辞書には両方あり、一方が他方の前方一致になっている。
      // 短い方を採ると別作品の短縮名を当ててしまう。
      expect(getShortTitle('機動戦士ガンダム 水星の魔女')).toBe('水星の魔女');
    });
  });

  describe('過剰に一致させない', () => {
    it('辞書に無い作品は null を返す', () => {
      expect(getShortTitle('実在しない架空の作品タイトル12345')).toBeNull();
    });

    it('短縮不要な作品は null を返す (short_title 未設定かつ前方一致なし)', () => {
      expect(getShortTitle('呪術廻戦')).toBeNull();
    });
  });
});
