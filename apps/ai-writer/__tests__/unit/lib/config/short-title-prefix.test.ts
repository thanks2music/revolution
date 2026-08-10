/**
 * `getShortTitle` の最長前方一致 (S1-d Phase 3、2026-08-09)
 *
 * 完全一致・alias 一致はどちらも**完全一致**しか見ないため、抽出された作品名に
 * 副題が付いていると一生ヒットしなかった。実測で
 *   「スター・ウォーズ／マンダロリアン・アンド・グローグー」(25 字)
 *   「Nissy Birthday Entertainment 2026」(33 字)
 * が辞書に当たらず、記事タイトルが 48 / 57 字に膨らんで**開催地が削られていた**。
 *
 * ★ **fixture を mock する。実辞書 (`templates/config/`) を読んではいけない。**
 *   あちらは `pnpm sync:templates` で生成される gitignored な同期コピーで、
 *   CI のクリーン checkout には存在しない。実際、当初は実辞書を読む設計にしたところ
 *   ローカルでは通り CI で全件落ちた。既存の `slug-resolver.test.ts` と同じく
 *   `yaml-loader` を mock する方式へ揃えている。
 *
 * ★ fixture の値は**実辞書に実在するエントリの写し**であり、捏造していない。
 */

import { describe, expect, it } from '@jest/globals';

jest.mock('../../../../lib/config/slug-generator', () => ({
  generateSlugWithFallback: jest.fn(),
}));

jest.mock('../../../../lib/config/yaml-loader', () => {
  const titles = {
    // 副題付きを前方一致で拾わせる対象 (short_title を持たない = キー自体が答え)
    'スター・ウォーズ': { slug: 'star-wars', english_title: 'Star Wars' },
    Nissy: { slug: 'nissy', english_title: 'Nissy' },
    'トイ・ストーリー': { slug: 'toy-story', english_title: 'Toy Story' },

    // 記号がタイトルの一部である作品 (完全一致が優先されることの確認用)
    'Fate/stay night': { slug: 'fate-stay-night', english_title: 'Fate/stay night', short_title: 'Fate' },
    'Re:ゼロから始める異世界生活': { slug: 'rezero', english_title: 'Re:Zero', short_title: 'リゼロ' },
    'ヴァイオレット・エヴァーガーデン': {
      slug: 'violet-evergarden',
      english_title: 'Violet Evergarden',
      short_title: 'ヴァイオレット',
    },
    'PSYCHO-PASS': { slug: 'psycho-pass', english_title: 'Psycho-Pass', short_title: 'サイコパス' },
    'マッシュル-MASHLE-': { slug: 'mashle', english_title: 'Mashle', short_title: 'マッシュル' },
    'ハイキュー!!': { slug: 'haikyu', english_title: 'Haikyu!!' },

    // 一方が他方の前方一致になる組 (最長一致の確認用)
    '機動戦士ガンダム': { slug: 'gundam', english_title: 'Mobile Suit Gundam' },
    '機動戦士ガンダム 水星の魔女': {
      slug: 'gundam-witch-from-mercury',
      english_title: 'The Witch from Mercury',
      short_title: '水星の魔女',
    },

    // 短縮不要 (short_title なし・前方一致もなし)
    '呪術廻戦': { slug: 'jujutsu-kaisen', english_title: 'Jujutsu Kaisen' },

    // 2 文字キー (前方一致の最小長ガードの確認用)
    '銀魂': { slug: 'gintama', english_title: 'Gintama' },
  };

  return {
    loadYamlConfig: jest.fn((key: string) => {
      if (key === 'TITLE_ROMAJI') return { titles };
      throw new Error(`unexpected config key: ${key}`);
    }),
  };
});

import { getShortTitle } from '@/lib/config/slug-resolver';

describe('getShortTitle — 最長前方一致', () => {
  describe('副題付きの作品名を拾う', () => {
    it('★ スター・ウォーズ／マンダロリアン・アンド・グローグー → スター・ウォーズ', () => {
      // 「／」が境界。short_title を持たないので**一致したキー自体**が返る
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
    it('Fate/stay night は完全一致が優先される (「/」で切らない)', () => {
      expect(getShortTitle('Fate/stay night')).toBe('Fate');
    });

    it('Re:ゼロから始める異世界生活 は「:」で切られない', () => {
      expect(getShortTitle('Re:ゼロから始める異世界生活')).toBe('リゼロ');
    });

    it('「・」を境界にしない (作品名の内部に出るため)', () => {
      // 「トイ・ストーリー」が登録済みでも「ヴァイオレット・エヴァーガーデン」を
      // 「ヴァイオレット」で切って別解釈しない = 完全一致が効いている
      expect(getShortTitle('ヴァイオレット・エヴァーガーデン')).toBe('ヴァイオレット');
    });

    it('「-」を境界にしない (PSYCHO-PASS / マッシュル-MASHLE-)', () => {
      expect(getShortTitle('PSYCHO-PASS')).toBe('サイコパス');
      expect(getShortTitle('マッシュル-MASHLE-')).toBe('マッシュル');
    });

    it('「!」を境界にしない (ハイキュー!! はタイトルの一部)', () => {
      // short_title を持たないので null。「ハイキュー」で切られて何かを返さないこと
      expect(getShortTitle('ハイキュー!!')).toBeNull();
    });
  });

  describe('最長一致を採る', () => {
    it('機動戦士ガンダム 水星の魔女 は短い「機動戦士ガンダム」に落ちない', () => {
      // 辞書には両方あり、一方が他方の前方一致になっている。
      // 短い方を採ると別作品の短縮名を当ててしまう。
      expect(getShortTitle('機動戦士ガンダム 水星の魔女')).toBe('水星の魔女');
    });

    it('未知の副題が付いても最長の登録キーを選ぶ', () => {
      expect(getShortTitle('機動戦士ガンダム 水星の魔女 Season 2')).toBe('水星の魔女');
    });
  });

  describe('過剰に一致させない', () => {
    it('辞書に無い作品は null を返す', () => {
      expect(getShortTitle('実在しない架空の作品タイトル12345')).toBeNull();
    });

    it('短縮不要な作品は null を返す (short_title 未設定かつ前方一致なし)', () => {
      expect(getShortTitle('呪術廻戦')).toBeNull();
    });

    it('2 文字キーは前方一致に使わない (誤爆防止)', () => {
      // 「銀魂」が登録済みでも、無関係な長い文字列の先頭に当てない
      expect(getShortTitle('銀魂 THE MOVIE')).toBeNull();
    });
  });
});
