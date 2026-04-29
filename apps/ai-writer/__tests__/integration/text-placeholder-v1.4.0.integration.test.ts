/**
 * @fileoverview Integration Tests for v1.4.0 Text Placeholder Features
 *
 * @description
 * v1.4.0 機能の統合テスト。実際のMDXテンプレートを使用して、
 * 以下の機能が連携して正しく動作することを検証:
 * - メディアタイプ派生変数 (is_idol_or_utaite, member_separator, メディアタイプ_label)
 * - 複数原作者派生変数 (原作者名_formatted, has_multiple_authors)
 * - 動的セパレーター対応 join ヘルパー
 *
 * カバレッジ目標: 80%以上
 *
 * @see /apps/ai-writer/lib/services/text-placeholder-replacer.service.ts
 * @see /apps/ai-writer/lib/utils/author-formatter.ts
 * @see /apps/ai-writer/lib/services/media-type-mapper.service.ts
 * @since v1.4.0
 */

import { TextPlaceholderReplacerService } from '../../lib/services/text-placeholder-replacer.service';
import type { TextPlaceholderData } from '../../lib/services/text-placeholder-replacer.service';

describe('Text Placeholder v1.4.0 Integration Tests', () => {
  let service: TextPlaceholderReplacerService;

  beforeEach(() => {
    service = new TextPlaceholderReplacerService();
  });

  describe('アイドル作品のMDX記事生成（実際のユースケース）', () => {
    it('アイドル作品で複数メンバー・複数原作者のテンプレートを正しく処理すること', () => {
      // アイドル作品の実データ
      const data: TextPlaceholderData = {
        作品名: 'ラブライブ！',
        メディアタイプ: 'idol',
        原作者名: ['公野櫻子先生', '鴨志田一先生'],
        店舗名: 'プリンセスカフェ',
        メンバー名: ['高坂穂乃果', '南ことり', '園田海未'],
        キャラクター名: ['高坂穂乃果', '南ことり', '園田海未'],
      };

      // 実際のMDXテンプレート（アイドル作品用）
      const template = `
## 作品情報

- **作品名**: {{作品名}}
- **メディアタイプ**: {{メディアタイプ_label}}
- **原作者**: {{原作者名_formatted}}
- **アイドル作品**: {{is_idol_or_utaite}}

## 登場メンバー

{{メンバー名|join:member_separator}}

## コラボカフェ情報

- **店舗名**: {{店舗名}}
- **出演キャラクター**: {{キャラクター名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // メディアタイプ派生変数の検証
      expect(result.content).toContain('**メディアタイプ**: アイドル');
      expect(result.content).toContain('**アイドル作品**: true');

      // 複数原作者派生変数の検証
      expect(result.content).toContain('**原作者**: 公野櫻子先生 / 鴨志田一先生');

      // 動的セパレーター（idol = " / "）の検証
      expect(result.content).toContain('高坂穂乃果 / 南ことり / 園田海未');

      // 複数箇所で同じ配列が正しく処理されていることを確認
      const memberSeparatorCount = (result.content.match(/高坂穂乃果 \/ 南ことり \/ 園田海未/g) || []).length;
      expect(memberSeparatorCount).toBe(2); // メンバー名とキャラクター名で2箇所

      // 置換回数の確認
      expect(result.replacedCount).toBeGreaterThanOrEqual(7);
    });

    it('アイドル作品で単一メンバー・単一原作者のテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'アイドルマスター',
        メディアタイプ: 'idol',
        原作者名: 'バンダイナムコエンターテインメント',
        メンバー名: ['天海春香'],
      };

      const template = `
- **原作**: {{原作者名_formatted}}
- **複数原作者**: {{has_multiple_authors}}
- **メンバー**: {{メンバー名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // 単一原作者
      expect(result.content).toContain('**原作**: バンダイナムコエンターテインメント');
      expect(result.content).toContain('**複数原作者**: false');

      // 単一メンバー（セパレーター不使用）
      expect(result.content).toContain('**メンバー**: 天海春香');
      expect(result.content).not.toContain(' / 天海春香');
    });
  });

  describe('アニメ作品のMDX記事生成（実際のユースケース）', () => {
    it('アニメ作品で複数キャラクター・単一原作者のテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'ONE PIECE',
        メディアタイプ: 'anime',
        原作者名: '尾田栄一郎先生',
        キャラクター名: ['ルフィ', 'ゾロ', 'ナミ', 'ウソップ'],
      };

      const template = `
## 作品情報

- **作品名**: {{作品名}}
- **メディアタイプ**: {{メディアタイプ_label}}
- **原作者**: {{原作者名_formatted}}
- **アイドル作品**: {{is_idol_or_utaite}}

## 登場キャラクター

{{キャラクター名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // メディアタイプ派生変数の検証
      expect(result.content).toContain('**メディアタイプ**: アニメ');
      expect(result.content).toContain('**アイドル作品**: false');

      // 単一原作者
      expect(result.content).toContain('**原作者**: 尾田栄一郎先生');

      // 動的セパレーター（anime = "・"）の検証
      expect(result.content).toContain('ルフィ・ゾロ・ナミ・ウソップ');

      // 置換回数の確認
      expect(result.replacedCount).toBeGreaterThanOrEqual(5);
    });

    it('アニメ作品で複数原作者のテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'CLAMP作品',
        メディアタイプ: 'anime',
        原作者名: ['CLAMP先生', '新條まゆ先生'],
        キャラクター名: ['さくら', '知世'],
      };

      const template = `
- **原作**: {{原作者名_formatted}}
- **複数原作者**: {{has_multiple_authors}}
- **キャラクター**: {{キャラクター名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // 複数原作者（常に " / " で結合）
      expect(result.content).toContain('**原作**: CLAMP先生 / 新條まゆ先生');
      expect(result.content).toContain('**複数原作者**: true');

      // キャラクター名は anime なので "・"
      expect(result.content).toContain('**キャラクター**: さくら・知世');
    });
  });

  describe('歌い手作品のMDX記事生成（実際のユースケース）', () => {
    it('歌い手作品で複数メンバーのテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: '歌い手ユニット',
        メディアタイプ: 'utaite',
        メンバー名: ['歌い手A', '歌い手B', '歌い手C'],
      };

      const template = `
## メンバー情報

- **メディアタイプ**: {{メディアタイプ_label}}
- **アイドル/歌い手**: {{is_idol_or_utaite}}
- **メンバー**: {{メンバー名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // メディアタイプ派生変数の検証
      expect(result.content).toContain('**メディアタイプ**: 歌い手');
      expect(result.content).toContain('**アイドル/歌い手**: true');

      // 動的セパレーター（utaite = " / "）の検証
      expect(result.content).toContain('**メンバー**: 歌い手A / 歌い手B / 歌い手C');
    });
  });

  describe('ゲーム作品のMDX記事生成（実際のユースケース）', () => {
    it('ゲーム作品で複数キャラクターのテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'ファイナルファンタジー',
        メディアタイプ: 'game',
        キャラクター名: ['クラウド', 'ティファ', 'エアリス'],
      };

      const template = `
- **メディアタイプ**: {{メディアタイプ_label}}
- **キャラクター**: {{キャラクター名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // メディアタイプ派生変数の検証
      expect(result.content).toContain('**メディアタイプ**: ゲーム');

      // 動的セパレーター（game = "・"）の検証
      expect(result.content).toContain('**キャラクター**: クラウド・ティファ・エアリス');
    });
  });

  describe('リテラルと動的セパレーターの混在使用', () => {
    it('同じ配列に対してリテラルと動的セパレーターを混在させて使用できること', () => {
      const data: TextPlaceholderData = {
        メディアタイプ: 'idol',
        メンバー名: ['田中', '佐藤', '鈴木'],
      };

      const template = `
- **固定セパレーター**: {{メンバー名|join:'・'}}
- **動的セパレーター（idol）**: {{メンバー名|join:member_separator}}
- **固定セパレーター（矢印）**: {{メンバー名|join:' → '}}
`.trim();

      const result = service.replaceAll(template, data);

      expect(result.content).toContain('**固定セパレーター**: 田中・佐藤・鈴木');
      expect(result.content).toContain('**動的セパレーター（idol）**: 田中 / 佐藤 / 鈴木');
      expect(result.content).toContain('**固定セパレーター（矢印）**: 田中 → 佐藤 → 鈴木');

      expect(result.replacedCount).toBe(3);
    });
  });

  describe('複雑なテンプレートの統合テスト', () => {
    it('すべてのv1.4.0機能を組み合わせた複雑なテンプレートを正しく処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'THE IDOLM@STER',
        メディアタイプ: 'idol',
        原作者名: ['バンダイナムコエンターテインメント', 'サイバーエージェント'],
        店舗名: 'アイマスカフェ',
        メンバー名: ['天海春香', '如月千早', '星井美希'],
        キャラクター名: ['天海春香', '如月千早', '星井美希'],
        グッズ名: ['アクリルスタンド', 'クリアファイル', '缶バッジ'],
      };

      const template = `
# {{作品名}} コラボカフェ

## 作品情報

- **作品名**: {{作品名}}
- **メディアタイプ**: {{メディアタイプ_label}}
- **原作**: {{原作者名_formatted}}
- **複数原作者**: {{has_multiple_authors}}
- **アイドル作品**: {{is_idol_or_utaite}}

## イベント詳細

- **店舗**: {{店舗名}}
- **出演キャラクター（固定）**: {{キャラクター名|join:'・'}}
- **出演キャラクター（動的）**: {{キャラクター名|join:member_separator}}

## メンバー

{{メンバー名|join:member_separator}}

## グッズ情報

{{グッズ名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // すべての機能が正しく動作していることを確認
      expect(result.content).toContain('**メディアタイプ**: アイドル');
      expect(result.content).toContain('**原作**: バンダイナムコエンターテインメント / サイバーエージェント');
      expect(result.content).toContain('**複数原作者**: true');
      expect(result.content).toContain('**アイドル作品**: true');
      expect(result.content).toContain('**出演キャラクター（固定）**: 天海春香・如月千早・星井美希');
      expect(result.content).toContain('**出演キャラクター（動的）**: 天海春香 / 如月千早 / 星井美希');
      expect(result.content).toContain('天海春香 / 如月千早 / 星井美希'); // メンバー
      expect(result.content).toContain('アクリルスタンド / クリアファイル / 缶バッジ'); // グッズ

      // 大量の置換が正しく行われていることを確認
      expect(result.replacedCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('エッジケースの統合テスト', () => {
    it('メディアタイプ未指定時にデフォルト動作すること', () => {
      const data: TextPlaceholderData = {
        作品名: '未分類作品',
        // メディアタイプ未指定
        キャラクター名: ['A', 'B', 'C'],
      };

      const template = `
- **メディアタイプ**: {{メディアタイプ_label}}
- **アイドル作品**: {{is_idol_or_utaite}}
- **キャラクター**: {{キャラクター名|join:member_separator}}
`.trim();

      const result = service.replaceAll(template, data);

      // メディアタイプ未指定時はプレースホルダーが残る
      expect(result.content).toContain('**メディアタイプ**: {{メディアタイプ_label}}');
      expect(result.content).toContain('**アイドル作品**: {{is_idol_or_utaite}}');

      // member_separator 未計算時はデフォルト "・" を使用
      expect(result.content).toContain('**キャラクター**: A・B・C');
    });

    it('原作者名未指定時にデフォルト動作すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'オリジナル作品',
        // 原作者名未指定
      };

      const template = `
- **原作**: {{原作者名_formatted}}
- **複数原作者**: {{has_multiple_authors}}
`.trim();

      const result = service.replaceAll(template, data);

      // 原作者名未指定時は空文字列と false
      expect(result.content).toContain('**原作**: ');
      expect(result.content).toContain('**複数原作者**: false');
    });

    it('空配列時に適切に処理されること', () => {
      const data: TextPlaceholderData = {
        メディアタイプ: 'idol',
        キャラクター名: [], // 空配列
      };

      const template = `{{キャラクター名|join:member_separator}}`;

      const result = service.replaceAll(template, data);

      // 空配列はプレースホルダーが残る
      expect(result.content).toBe('{{キャラクター名|join:member_separator}}');
      expect(result.replacedCount).toBe(0);
    });

    it('null値時に適切に処理されること', () => {
      const data: TextPlaceholderData = {
        原作者名: null,
        キャラクター名: null,
      };

      const template = `
- **原作**: {{原作者名_formatted}}
- **複数原作者**: {{has_multiple_authors}}
- **キャラクター**: {{キャラクター名|join:'・'}}
`.trim();

      const result = service.replaceAll(template, data);

      // 原作者名 null は空文字列と false
      expect(result.content).toContain('**原作**: ');
      expect(result.content).toContain('**複数原作者**: false');

      // キャラクター名 null はプレースホルダーが残る
      expect(result.content).toContain('**キャラクター**: {{キャラクター名|join:\'・\'}}');
    });
  });

  describe('パフォーマンステスト', () => {
    it('大量のプレースホルダーを含むテンプレートを効率的に処理すること', () => {
      const data: TextPlaceholderData = {
        作品名: 'パフォーマンステスト作品',
        メディアタイプ: 'idol',
        原作者名: ['作者1', '作者2', '作者3', '作者4', '作者5'],
        メンバー名: Array.from({ length: 20 }, (_, i) => `メンバー${i + 1}`),
        キャラクター名: Array.from({ length: 20 }, (_, i) => `キャラクター${i + 1}`),
      };

      // 100個のプレースホルダーを含むテンプレート
      let template = '';
      for (let i = 0; i < 20; i++) {
        template += `{{作品名}} / {{メディアタイプ_label}} / {{原作者名_formatted}} / {{メンバー名|join:member_separator}} / {{キャラクター名|join:member_separator}}\n`;
      }

      const startTime = Date.now();
      const result = service.replaceAll(template, data);
      const endTime = Date.now();

      // 処理時間が許容範囲内（1秒以内）
      expect(endTime - startTime).toBeLessThan(1000);

      // すべてのプレースホルダーが置換されていること
      expect(result.content).not.toContain('{{');
      expect(result.content).not.toContain('}}');

      // 置換回数の確認（派生変数のキャッシングにより実際の回数は100未満）
      // 最低でも40回以上は置換されていることを確認
      expect(result.replacedCount).toBeGreaterThanOrEqual(40);
    });
  });
});
