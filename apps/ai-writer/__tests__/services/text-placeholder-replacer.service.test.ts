/**
 * @fileoverview Unit Tests for TextPlaceholderReplacerService (v1.4.0 Features)
 *
 * @description
 * v1.4.0 で追加された機能のユニットテスト:
 * - computeDerivedVariables の v1.4.0 派生変数（メディアタイプ関連、複数原作者関連）
 * - 動的セパレーター対応の join ヘルパー（リテラル・動的）
 *
 * カバレッジ目標: 90%以上
 *
 * @see /apps/ai-writer/lib/services/text-placeholder-replacer.service.ts
 * @since v1.4.0
 */

import { TextPlaceholderReplacerService } from '../../lib/services/text-placeholder-replacer.service';
import type { TextPlaceholderData } from '../../lib/services/text-placeholder-replacer.service';

describe('TextPlaceholderReplacerService (v1.4.0 Features)', () => {
  let service: TextPlaceholderReplacerService;

  beforeEach(() => {
    service = new TextPlaceholderReplacerService();
  });

  describe('computeDerivedVariables - v1.4.0 メディアタイプ派生変数', () => {
    describe('is_idol_or_utaite の計算', () => {
      it('メディアタイプが idol の場合は true を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
        };

        const result = service.replaceAll('{{is_idol_or_utaite}}', data);

        expect(result.content).toBe('true');
        expect(result.replacedCount).toBe(1);
      });

      it('メディアタイプが utaite の場合は true を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'utaite',
        };

        const result = service.replaceAll('{{is_idol_or_utaite}}', data);

        expect(result.content).toBe('true');
      });

      it('メディアタイプが anime の場合は false を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
        };

        const result = service.replaceAll('{{is_idol_or_utaite}}', data);

        expect(result.content).toBe('false');
      });

      it('メディアタイプが未指定の場合はプレースホルダーを置換しないこと', () => {
        const data: TextPlaceholderData = {};

        const result = service.replaceAll('{{is_idol_or_utaite}}', data);

        expect(result.content).toBe('{{is_idol_or_utaite}}');
        expect(result.replacedCount).toBe(0);
      });
    });

    describe('member_separator の計算', () => {
      it('メディアタイプが idol の場合は " / " を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe(' / ');
        expect(result.replacedCount).toBe(1);
      });

      it('メディアタイプが utaite の場合は " / " を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'utaite',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe(' / ');
      });

      // Sprint C-β P11 §6.1 準拠: anime / game の character_separator "・" → "、" (2026-07-19)
      it('メディアタイプが anime の場合は "、" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe('、');
      });

      it('メディアタイプが game の場合は "、" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'game',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe('、');
      });
    });

    describe('メディアタイプ_label の計算', () => {
      it('メディアタイプが idol の場合は "アイドル" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
        };

        const result = service.replaceAll('{{メディアタイプ_label}}', data);

        expect(result.content).toBe('アイドル');
        expect(result.replacedCount).toBe(1);
      });

      it('メディアタイプが anime の場合は "アニメ" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
        };

        const result = service.replaceAll('{{メディアタイプ_label}}', data);

        expect(result.content).toBe('アニメ');
      });

      it('メディアタイプが game の場合は "ゲーム" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'game',
        };

        const result = service.replaceAll('{{メディアタイプ_label}}', data);

        expect(result.content).toBe('ゲーム');
      });
    });
  });

  describe('computeDerivedVariables - v1.4.0 複数原作者派生変数', () => {
    describe('原作者名_formatted の計算', () => {
      it('単一原作者の場合はそのまま返すこと', () => {
        const data: TextPlaceholderData = {
          原作者名: '尾田栄一郎先生',
        };

        const result = service.replaceAll('{{原作者名_formatted}}', data);

        expect(result.content).toBe('尾田栄一郎先生');
        expect(result.replacedCount).toBe(1);
      });

      it('複数原作者の場合は " / " で結合すること', () => {
        const data: TextPlaceholderData = {
          原作者名: ['CLAMP先生', '新條まゆ先生'],
        };

        const result = service.replaceAll('{{原作者名_formatted}}', data);

        expect(result.content).toBe('CLAMP先生 / 新條まゆ先生');
      });

      it('原作者名が null の場合は空文字列を返すこと', () => {
        const data: TextPlaceholderData = {
          原作者名: null,
        };

        const result = service.replaceAll('{{原作者名_formatted}}', data);

        expect(result.content).toBe('');
      });
    });

    describe('has_multiple_authors の計算', () => {
      it('複数原作者（2人以上）の場合は true を計算すること', () => {
        const data: TextPlaceholderData = {
          原作者名: ['CLAMP先生', '新條まゆ先生'],
        };

        const result = service.replaceAll('{{has_multiple_authors}}', data);

        expect(result.content).toBe('true');
        expect(result.replacedCount).toBe(1);
      });

      it('単一原作者の場合は false を計算すること', () => {
        const data: TextPlaceholderData = {
          原作者名: '尾田栄一郎先生',
        };

        const result = service.replaceAll('{{has_multiple_authors}}', data);

        expect(result.content).toBe('false');
      });

      it('1人だけの配列の場合は false を計算すること', () => {
        const data: TextPlaceholderData = {
          原作者名: ['尾田栄一郎先生'],
        };

        const result = service.replaceAll('{{has_multiple_authors}}', data);

        expect(result.content).toBe('false');
      });

      it('原作者名が null の場合は false を計算すること', () => {
        const data: TextPlaceholderData = {
          原作者名: null,
        };

        const result = service.replaceAll('{{has_multiple_authors}}', data);

        expect(result.content).toBe('false');
      });
    });
  });

  describe('Enhanced Join Helper - v1.4.0 動的セパレーター対応', () => {
    describe('キャラクター名 のリテラルセパレーター', () => {
      it('{{キャラクター名|join:"・"}} パターンで正しく結合すること', () => {
        const data: TextPlaceholderData = {
          キャラクター名: ['ルフィ', 'ゾロ', 'ナミ'],
        };

        const result = service.replaceAll('{{キャラクター名|join:\'・\'}}', data);

        expect(result.content).toBe('ルフィ・ゾロ・ナミ');
        expect(result.replacedCount).toBe(1);
      });

      it('{{キャラクター名|join:" / "}} パターンで正しく結合すること', () => {
        const data: TextPlaceholderData = {
          キャラクター名: ['田中', '佐藤', '鈴木'],
        };

        const result = service.replaceAll('{{キャラクター名|join:\' / \'}}', data);

        expect(result.content).toBe('田中 / 佐藤 / 鈴木');
      });

      it('キャラクター名が1人だけの場合はセパレーターなしで返すこと', () => {
        const data: TextPlaceholderData = {
          キャラクター名: ['ルフィ'],
        };

        const result = service.replaceAll('{{キャラクター名|join:\'・\'}}', data);

        expect(result.content).toBe('ルフィ');
      });

      it('キャラクター名が空配列の場合はプレースホルダーを置換しないこと', () => {
        const data: TextPlaceholderData = {
          キャラクター名: [],
        };

        const result = service.replaceAll('{{キャラクター名|join:\'・\'}}', data);

        // 空配列は length === 0 のため、join処理が実行されない
        expect(result.content).toBe('{{キャラクター名|join:\'・\'}}');
        expect(result.replacedCount).toBe(0);
      });
    });

    describe('キャラクター名 の動的セパレーター', () => {
      it('{{キャラクター名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (idol)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
          キャラクター名: ['田中', '佐藤', '鈴木'],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        expect(result.content).toBe('田中 / 佐藤 / 鈴木'); // idol は " / "
      });

      // Sprint C-β P11 §6.1 準拠: anime character_separator "・" → "、" (2026-07-19)
      it('{{キャラクター名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (anime)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
          キャラクター名: ['ルフィ', 'ゾロ', 'ナミ'],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        expect(result.content).toBe('ルフィ、ゾロ、ナミ'); // anime は "、" (§6.1 訂正)
      });

      it('member_separator が未定義の場合はデフォルト "、" を使用すること (§6.1)', () => {
        const data: TextPlaceholderData = {
          // メディアタイプ未指定 = member_separator 未計算
          キャラクター名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        expect(result.content).toBe('A、B、C');
      });
    });

    describe('グッズ名 のリテラルセパレーター', () => {
      it('{{グッズ名|join:"・"}} パターンで正しく結合すること', () => {
        const data: TextPlaceholderData = {
          グッズ名: ['Tシャツ', 'マグカップ', 'キーホルダー'],
        };

        const result = service.replaceAll('{{グッズ名|join:\'・\'}}', data);

        expect(result.content).toBe('Tシャツ・マグカップ・キーホルダー');
      });
    });

    describe('グッズ名 の動的セパレーター', () => {
      it('{{グッズ名|join:member_separator}} でメディアタイプ別セパレーターを使用すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
          グッズ名: ['Tシャツ', 'マグカップ'],
        };

        const result = service.replaceAll('{{グッズ名|join:member_separator}}', data);

        expect(result.content).toBe('Tシャツ / マグカップ'); // idol は " / "
      });
    });

    describe('メンバー名 のリテラルセパレーター (v1.4.0 新規)', () => {
      it('{{メンバー名|join:"・"}} パターンで正しく結合すること', () => {
        const data: TextPlaceholderData = {
          メンバー名: ['田中', '佐藤', '鈴木'],
        };

        const result = service.replaceAll('{{メンバー名|join:\'・\'}}', data);

        expect(result.content).toBe('田中・佐藤・鈴木');
      });

      it('{{メンバー名|join:" / "}} パターンで正しく結合すること', () => {
        const data: TextPlaceholderData = {
          メンバー名: ['田中', '佐藤', '鈴木'],
        };

        const result = service.replaceAll('{{メンバー名|join:\' / \'}}', data);

        expect(result.content).toBe('田中 / 佐藤 / 鈴木');
      });
    });

    describe('メンバー名 の動的セパレーター (v1.4.0 新規)', () => {
      it('{{メンバー名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (idol)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
          メンバー名: ['田中', '佐藤', '鈴木'],
        };

        const result = service.replaceAll('{{メンバー名|join:member_separator}}', data);

        expect(result.content).toBe('田中 / 佐藤 / 鈴木'); // idol は " / "
      });

      // Sprint C-β P11 §6.1 準拠: anime character_separator "・" → "、" (2026-07-19)
      it('{{メンバー名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (anime)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
          メンバー名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll('{{メンバー名|join:member_separator}}', data);

        expect(result.content).toBe('A、B、C'); // anime は "、" (§6.1 訂正)
      });
    });

    describe('複数プレースホルダーの同時処理', () => {
      it('リテラルと動的セパレーターを混在させて使用できること', () => {
        const template = `
キャラクター（固定）: {{キャラクター名|join:'・'}}
メンバー（動的）: {{メンバー名|join:member_separator}}
`;
        const data: TextPlaceholderData = {
          メディアタイプ: 'idol',
          キャラクター名: ['A', 'B'],
          メンバー名: ['田中', '佐藤'],
        };

        const result = service.replaceAll(template, data);

        expect(result.content).toContain('キャラクター（固定）: A・B');
        expect(result.content).toContain('メンバー（動的）: 田中 / 佐藤');
        expect(result.replacedCount).toBe(2);
      });

      it('同じ配列に対して異なるセパレーターを使用できること', () => {
        const template = `
パターン1: {{キャラクター名|join:'・'}}
パターン2: {{キャラクター名|join:' / '}}
`;
        const data: TextPlaceholderData = {
          キャラクター名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll(template, data);

        expect(result.content).toContain('パターン1: A・B・C');
        expect(result.content).toContain('パターン2: A / B / C');
        expect(result.replacedCount).toBe(2);
      });
    });
  });

  describe('統合テスト: v1.4.0 機能の組み合わせ', () => {
    it('メディアタイプ派生変数と動的セパレーターを組み合わせて使用できること', () => {
      const template = `
メディアタイプ: {{メディアタイプ_label}}
アイドル判定: {{is_idol_or_utaite}}
メンバー: {{メンバー名|join:member_separator}}
`;
      const data: TextPlaceholderData = {
        メディアタイプ: 'idol',
        メンバー名: ['田中', '佐藤', '鈴木'],
      };

      const result = service.replaceAll(template, data);

      expect(result.content).toContain('メディアタイプ: アイドル');
      expect(result.content).toContain('アイドル判定: true');
      expect(result.content).toContain('メンバー: 田中 / 佐藤 / 鈴木');
      expect(result.replacedCount).toBe(3);
    });

    it('複数原作者派生変数と他の変数を組み合わせて使用できること', () => {
      const template = `
原作者: {{原作者名_formatted}}
複数原作者フラグ: {{has_multiple_authors}}
`;
      const data: TextPlaceholderData = {
        原作者名: ['CLAMP先生', '新條まゆ先生'],
      };

      const result = service.replaceAll(template, data);

      expect(result.content).toContain('原作者: CLAMP先生 / 新條まゆ先生');
      expect(result.content).toContain('複数原作者フラグ: true');
      expect(result.replacedCount).toBe(2);
    });
  });

  describe('エッジケース', () => {
    describe('空配列の処理', () => {
      it('キャラクター名が空配列の場合はプレースホルダーを置換しないこと', () => {
        const data: TextPlaceholderData = {
          キャラクター名: [],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        // 空配列は length === 0 のため、join処理が実行されない
        expect(result.content).toBe('{{キャラクター名|join:member_separator}}');
        expect(result.replacedCount).toBe(0);
      });
    });

    describe('null/undefined の処理', () => {
      it('キャラクター名が null の場合はプレースホルダーをそのまま残すこと', () => {
        const data: TextPlaceholderData = {
          キャラクター名: null,
        };

        const result = service.replaceAll('{{キャラクター名|join:\'・\'}}', data);

        expect(result.content).toBe('{{キャラクター名|join:\'・\'}}');
        expect(result.replacedCount).toBe(0);
      });
    });

    describe('特殊文字を含むセパレーター', () => {
      it('セパレーターに特殊文字を含む場合でも正しく動作すること', () => {
        const data: TextPlaceholderData = {
          キャラクター名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll('{{キャラクター名|join:\' → \'}}', data);

        expect(result.content).toBe('A → B → C');
      });
    });
  });
  // ===================================
  // S1-d Phase 3 (2026-08-09): 会場系派生変数
  // ===================================
  //
  // ★ 回帰ガード。simpleVariables は**明示登録方式**なので、`TextPlaceholderData` に
  //   field を足すだけでは置換されない。実際 field 追加だけで dry-run したところ
  //   `{{見出し主語}}` が 5 件そのまま本文に残った (replacedCount: 0)。
  //   **型は通るため CI では気づけない**類の取りこぼしなので、テストで固定する。
  describe('S1-d Phase 3 — 会場系派生変数の置換', () => {
    const base: TextPlaceholderData = {
      作品名: 'トイ・ストーリー5',
      店舗名: 'OH MY CAFE',
      見出し主語: 'トイ・ストーリー5 × OH MY CAFE',
      代表店舗名: 'OH MY CAFE',
      会場一覧表記: 'OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店',
      会場数: 5,
      is_multi_venue: true,
    };

    it('{{見出し主語}} を置換する (未登録だと本文に残る)', () => {
      const r = service.replaceAll('## {{見出し主語}}のメニュー', base);

      expect(r.content).toBe('## トイ・ストーリー5 × OH MY CAFE のメニュー'.replace(' のメニュー', 'のメニュー'));
      expect(r.unreplacedPlaceholders).not.toContain('{{見出し主語}}');
    });

    it('同一プレースホルダーが複数回出ても全て置換する', () => {
      const src = [
        '## {{見出し主語}}のメニュー',
        '「{{見出し主語}}」では、コラボメニューがラインナップ!',
        '## {{見出し主語}}のグッズ',
      ].join('\n');

      const r = service.replaceAll(src, base);

      expect(r.content).not.toContain('{{見出し主語}}');
      expect(r.unreplacedPlaceholders).toHaveLength(0);
    });

    it('会場系の 5 変数がすべて置換される', () => {
      const src = '{{見出し主語}} / {{代表店舗名}} / {{会場一覧表記}} / {{会場数}} / {{is_multi_venue}}';

      const r = service.replaceAll(src, base);

      expect(r.content).toContain('トイ・ストーリー5 × OH MY CAFE');
      expect(r.content).toContain('OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店');
      expect(r.content).toContain('5');
      expect(r.content).toContain('true');
      expect(r.unreplacedPlaceholders).toHaveLength(0);
    });

    it('多ブランドで代表が決まらない形 (Step 5) も置換できる', () => {
      const r = service.replaceAll('## {{見出し主語}}のメニュー', {
        作品名: 'D.Gray-man',
        店舗名: 'キャラウムカフェ',
        見出し主語: 'D.Gray-man カフェ in 東京・大阪',
        代表店舗名: '',
        会場数: 2,
        is_multi_venue: true,
      });

      expect(r.content).toBe('## D.Gray-man カフェ in 東京・大阪のメニュー');
      expect(r.content).not.toContain('MEDICOS');
    });

    it('会場数 0 / is_multi_venue false でも undefined 扱いにしない', () => {
      // String(0) は falsy 判定に引っかかりやすい。0 と false が消えないことを固定する。
      const r = service.replaceAll('{{会場数}}/{{is_multi_venue}}', {
        作品名: 'テスト作品',
        店舗名: 'テスト店舗',
        会場数: 0,
        is_multi_venue: false,
      });

      expect(r.content).toBe('0/false');
    });
  });
});
