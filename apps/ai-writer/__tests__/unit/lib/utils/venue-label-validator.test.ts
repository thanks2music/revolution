import { describe, expect, it } from '@jest/globals';

import { validateVenueLabel } from '@/lib/utils/venue-label-validator';

describe('validateVenueLabel', () => {
  describe('会場として通すもの (過剰に弾かない)', () => {
    // すべて実データに存在する会場名。捏造していない。
    const 実在の会場 = [
      'BOX cafe&space マツモトキヨシ池袋Part2店',
      'OH MY CAFE 表参道ヒルズ',
      'BALLER:S イオンモール新利府店',
      'キャラウムカフェ（池袋 マルビル4階）',
      'CAFE EPIC TALE',
      'Collabo_Index SHINSAIBASHI',
      'コーチャンフォー新川通り店 カフェ インターリュード',
      // ★ 辞書に無いが実在の会場。ブランド未登録と「会場でない」は別問題
      'JR京都駅 西口改札前 特設会場',
    ];

    it.each(実在の会場)('%s を通す', (label) => {
      expect(validateVenueLabel(label)).toBeNull();
    });

    it('★「全国17箇所のイオンモール内スペース」を弾かない', () => {
      // 会場名が個別列挙されないケースはそのまま 1 要素で保存する (BOSS 確定 2026-08-09)。
      // 「全国」を前方一致で弾くとこれを巻き込むため、完全一致でしか判定しない。
      expect(validateVenueLabel('全国17箇所のイオンモール内スペース')).toBeNull();
    });

    it('「特設会場」を含んでも弾かない', () => {
      expect(validateVenueLabel('JR京都駅 西口改札前 特設会場')).toBeNull();
    });
  });

  describe('販売・受付チャネルを弾く', () => {
    it('★ ONLINE販売 を弾く (実測で見出しに出ていた)', () => {
      const r = validateVenueLabel('ONLINE販売');
      expect(r).not.toBeNull();
      expect(r).toContain('会場ではありません');
    });

    it.each(['オンライン', 'ONLINE', 'オンラインストア', '通販', '通信販売', '公式オンラインストア', '特設サイト', 'EC'])(
      '%s を弾く',
      (label) => {
        expect(validateVenueLabel(label)).not.toBeNull();
      }
    );
  });

  describe('場所の総称を弾く', () => {
    it.each(['全国', '全国各地', '各地', '未定', '後日発表'])('%s を弾く', (label) => {
      expect(validateVenueLabel(label)).not.toBeNull();
    });
  });

  describe('都道府県名を弾く', () => {
    it('★ 抽出された都道府県と同じ文字列を弾く (実測で会場として入っていた)', () => {
      const prefs = ['東京都', '愛知県', '大阪府'];
      for (const label of ['東京', '愛知', '大阪']) {
        const r = validateVenueLabel(label, prefs);
        expect(r).not.toBeNull();
        expect(r).toContain('都道府県名');
      }
    });

    it('接尾辞付きの表記でも弾く', () => {
      expect(validateVenueLabel('東京都', ['東京都'])).not.toBeNull();
    });

    it('北海道を「北海」に丸めない', () => {
      expect(validateVenueLabel('北海道', ['北海道'])).not.toBeNull();
      // 「北海」は都道府県ではないので、それ単体では都道府県判定に当たらない
      expect(validateVenueLabel('北海道グルメ館', ['北海道'])).toBeNull();
    });

    it('都道府県名を含むだけの会場は弾かない', () => {
      expect(validateVenueLabel('BOX cafe&space 東京ソラマチ店', ['東京都'])).toBeNull();
    });

    it('prefectures が渡されなければ都道府県判定をしない', () => {
      expect(validateVenueLabel('東京')).toBeNull();
    });
  });

  describe('境界', () => {
    it('空文字を弾く', () => {
      expect(validateVenueLabel('')).not.toBeNull();
    });

    it('全角空白のみを弾く', () => {
      expect(validateVenueLabel('　　')).not.toBeNull();
    });

    it('前後の空白を無視して判定する', () => {
      expect(validateVenueLabel('  ONLINE販売  ')).not.toBeNull();
    });
  });
  describe('地名を「・」で連結した値を弾く (claude[bot] 指摘 2026-08-09)', () => {
    const prefs = ['東京都', '愛知県', '大阪府'];

    it('★ 東京・愛知・大阪 を弾く (実測で venue_label に入っていた値)', () => {
      const r = validateVenueLabel('東京・愛知・大阪', prefs);
      expect(r).not.toBeNull();
      expect(r).toContain('連結');
    });

    it('接尾辞付きの連結も弾く', () => {
      expect(validateVenueLabel('東京都・大阪府', prefs)).not.toBeNull();
    });

    it('★ 会場名が混ざる場合は弾かない (情報を失わないため)', () => {
      // 「東京・BOX cafe&space」は会場名を含むので除外しない。
      // 全要素が地名のときだけ弾く。
      expect(validateVenueLabel('東京・BOX cafe&space 東京ソラマチ店', prefs)).toBeNull();
    });

    it('会場名の内部に出る「・」を巻き込まない', () => {
      // occurrence-normalizer が「・」で分割しない理由と同じ。
      expect(validateVenueLabel('ルミネエスト新宿 1号店・2号店', prefs)).toBeNull();
      expect(validateVenueLabel('トイ・ストーリー カフェ 表参道', prefs)).toBeNull();
    });

    it('prefectures が渡されなければ連結判定をしない', () => {
      expect(validateVenueLabel('東京・愛知・大阪')).toBeNull();
    });
  });
});
