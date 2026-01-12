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

      it('メディアタイプが anime の場合は "・" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe('・');
      });

      it('メディアタイプが game の場合は "・" を計算すること', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'game',
        };

        const result = service.replaceAll('{{member_separator}}', data);

        expect(result.content).toBe('・');
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

      it('{{キャラクター名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (anime)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
          キャラクター名: ['ルフィ', 'ゾロ', 'ナミ'],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        expect(result.content).toBe('ルフィ・ゾロ・ナミ'); // anime は "・"
      });

      it('member_separator が未定義の場合はデフォルト "・" を使用すること', () => {
        const data: TextPlaceholderData = {
          // メディアタイプ未指定 = member_separator 未計算
          キャラクター名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll('{{キャラクター名|join:member_separator}}', data);

        expect(result.content).toBe('A・B・C');
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

      it('{{メンバー名|join:member_separator}} でメディアタイプ別セパレーターを使用すること (anime)', () => {
        const data: TextPlaceholderData = {
          メディアタイプ: 'anime',
          メンバー名: ['A', 'B', 'C'],
        };

        const result = service.replaceAll('{{メンバー名|join:member_separator}}', data);

        expect(result.content).toBe('A・B・C'); // anime は "・"
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
});
