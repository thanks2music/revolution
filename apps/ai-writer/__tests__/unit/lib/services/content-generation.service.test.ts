/**
 * ContentGenerationService の単体テスト
 *
 * @description
 * content-generation.service.ts のテスト。
 * 特に、v2.3.0 で実装された YAML からのプロンプト読み込み機能をテスト。
 *
 * @see /notes/04-review/2025-12-30-02-逆提案を受けての調査報告と実装方針案.md
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { MergedModularTemplate } from '../../../../lib/types/modular-template';
import type { AiProvider } from '../../../../lib/ai/providers/ai-provider.interface';
import {
  ContentGenerationService,
  type CategoryImages,
} from '../../../../lib/services/content-generation.service';

// モック AiProvider
const createMockAiProvider = (): jest.Mocked<AiProvider> => ({
  sendMessage: jest.fn().mockResolvedValue({
    content: '{}',
    model: 'mock-model',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }),
  getModelName: jest.fn().mockReturnValue('mock-model'),
} as jest.Mocked<AiProvider>);

// モック YamlTemplateLoaderService
const createMockTemplateLoader = () => ({
  loadTemplate: jest.fn(),
  loadModularTemplate: jest.fn(),
});

// モック用のテンプレート（YAML から読み込まれる想定）
const createMockTemplate = (
  categoryImagesInstruction?: string
): Partial<MergedModularTemplate> => ({
  _meta: {
    meta: {
      id: 'collabo-cafe',
      name: 'Test Template',
      version: '2.3.0',
      description: 'Test',
      output_format: 'mdx',
      event_types: ['collabo-cafe'],
    },
    pipeline: {
      order: ['4-content'],
      dependencies: {},
    },
    sections: {
      order: ['lead', 'menu', 'novelty', 'goods', 'summary'],
      conditional: {},
    },
    shared: [],
  },
  _shared: {
    placeholders: {
      version: '1.0.0',
      placeholders: { required: [], optional: [] },
    },
    constraints: {
      version: '1.0.0',
      title: {},
      meta_description: {},
      content: {},
      date_format: {
        year: '',
        date: '',
        pattern: {},
      },
      url_validation: {
        pattern: '',
        official_domains: [],
      },
    },
  },
  template: {
    id: '4-content',
    name: 'コラボカフェ（本文生成）',
    version: '2.3.0',
    description: 'Test',
  },
  logic: categoryImagesInstruction
    ? { category_images_instruction: categoryImagesInstruction }
    : {},
  prompts: {
    generate_content: 'テスト用プロンプト',
  },
});

// テスト用のカテゴリ画像データ
const createMockCategoryImages = (
  menuCount: number,
  noveltyCount: number,
  goodsCount: number
): CategoryImages => ({
  menu: Array(menuCount)
    .fill(null)
    .map((_, i) => `https://example.com/menu${i + 1}.jpg`),
  novelty: Array(noveltyCount)
    .fill(null)
    .map((_, i) => `https://example.com/novelty${i + 1}.jpg`),
  goods: Array(goodsCount)
    .fill(null)
    .map((_, i) => `https://example.com/goods${i + 1}.jpg`),
});

describe('ContentGenerationService', () => {
  // ===============================================
  // buildCategoryImagesSection / buildCategoryImagesTable
  // ===============================================

  describe('カテゴリ別画像情報セクション構築（YAML読み込み）', () => {
    // private メソッドをテストするためのヘルパー
    const getBuildCategoryImagesSection = (service: ContentGenerationService) => {
      return (service as any).buildCategoryImagesSection.bind(service);
    };

    const getBuildCategoryImagesTable = (service: ContentGenerationService) => {
      return (service as any).buildCategoryImagesTable.bind(service);
    };

    let service: ContentGenerationService;
    let mockTemplateLoader: ReturnType<typeof createMockTemplateLoader>;
    let mockAiProvider: jest.Mocked<AiProvider>;

    beforeEach(() => {
      mockTemplateLoader = createMockTemplateLoader();
      mockAiProvider = createMockAiProvider();
      // モック依存性をコンストラクタに注入
      service = new ContentGenerationService(
        mockTemplateLoader as any,
        mockAiProvider
      );
    });

    describe('buildCategoryImagesTable', () => {
      it('すべてのカテゴリに画像がある場合、正しいテーブルを生成する', () => {
        const buildTable = getBuildCategoryImagesTable(service);
        const categoryImages = createMockCategoryImages(3, 2, 5);

        const result = buildTable(categoryImages);

        expect(result).toContain('| カテゴリ | 画像数 | アクション |');
        expect(result).toContain('| メニュー | 3件 | セクション生成 |');
        expect(result).toContain('| ノベルティ | 2件 | セクション生成 |');
        expect(result).toContain('| グッズ | 5件 | セクション生成 |');
      });

      it('一部のカテゴリに画像がない場合、スキップを表示する', () => {
        const buildTable = getBuildCategoryImagesTable(service);
        const categoryImages = createMockCategoryImages(2, 0, 0);

        const result = buildTable(categoryImages);

        expect(result).toContain('| メニュー | 2件 | セクション生成 |');
        expect(result).toContain('| ノベルティ | 0件 | スキップ |');
        expect(result).toContain('| グッズ | 0件 | スキップ |');
      });

      it('すべてのカテゴリに画像がない場合、全スキップを表示する', () => {
        const buildTable = getBuildCategoryImagesTable(service);
        const categoryImages = createMockCategoryImages(0, 0, 0);

        const result = buildTable(categoryImages);

        expect(result).toContain('| メニュー | 0件 | スキップ |');
        expect(result).toContain('| ノベルティ | 0件 | スキップ |');
        expect(result).toContain('| グッズ | 0件 | スキップ |');
      });
    });

    describe('buildCategoryImagesSection', () => {
      it('categoryImages が undefined の場合、空文字列を返す', () => {
        const buildSection = getBuildCategoryImagesSection(service);
        const template = createMockTemplate(
          '### カテゴリ別画像情報\n{{category_images_table}}'
        );

        const result = buildSection(template, undefined);

        expect(result).toBe('');
      });

      it('YAML に category_images_instruction がない場合、空文字列を返す', () => {
        const buildSection = getBuildCategoryImagesSection(service);
        const template = createMockTemplate(); // instruction なし
        const categoryImages = createMockCategoryImages(3, 2, 1);

        const result = buildSection(template, categoryImages);

        expect(result).toBe('');
      });

      it('YAML の category_images_instruction から指示文を読み込み、テーブルを置換する', () => {
        const buildSection = getBuildCategoryImagesSection(service);
        const instructionTemplate = `### カテゴリ別画像情報（Step 1.7 で抽出）

**重要**: 以下の画像情報に基づいてセクションのスキップを判断してください。

{{category_images_table}}

**プレースホルダー出力ルール**:
- menu セクション生成時: \`{ここにメニューの画像を入れる}\` を必ず含める`;

        const template = createMockTemplate(instructionTemplate);
        const categoryImages = createMockCategoryImages(3, 0, 2);

        const result = buildSection(template, categoryImages);

        // YAML の指示文が含まれていること
        expect(result).toContain('### カテゴリ別画像情報（Step 1.7 で抽出）');
        expect(result).toContain('**重要**:');
        expect(result).toContain('**プレースホルダー出力ルール**:');

        // テーブルがプレースホルダーから置換されていること
        expect(result).not.toContain('{{category_images_table}}');
        expect(result).toContain('| メニュー | 3件 | セクション生成 |');
        expect(result).toContain('| ノベルティ | 0件 | スキップ |');
        expect(result).toContain('| グッズ | 2件 | セクション生成 |');
      });

      it('実際の 4-content.yaml v2.3.0 形式の instruction を正しく処理する', () => {
        const buildSection = getBuildCategoryImagesSection(service);
        // 4-content.yaml v2.3.0 の実際のフォーマット
        const actualInstructionTemplate = `### カテゴリ別画像情報（Step 1.7 で抽出）

**重要**: 以下の画像情報に基づいてセクションのスキップを判断してください。
- 画像が1件以上ある場合 → セクションを生成し、プレースホルダーを出力
- 画像が0件の場合 → セクションをスキップ

{{category_images_table}}

**プレースホルダー出力ルール**:
- menu セクション生成時: \`{ここにメニューの画像を入れる}\` を必ず含める
- novelty セクション生成時: \`{ここにノベルティの画像を入れる}\` を必ず含める
- goods セクション生成時: \`{ここにグッズの画像を入れる}\` を必ず含める
`;

        const template = createMockTemplate(actualInstructionTemplate);
        const categoryImages = createMockCategoryImages(5, 3, 0);

        const result = buildSection(template, categoryImages);

        // 全体構造の確認
        expect(result).toContain('### カテゴリ別画像情報（Step 1.7 で抽出）');
        expect(result).toContain('- 画像が1件以上ある場合 → セクションを生成し、プレースホルダーを出力');
        expect(result).toContain('- 画像が0件の場合 → セクションをスキップ');

        // テーブル置換の確認
        expect(result).toContain('| メニュー | 5件 | セクション生成 |');
        expect(result).toContain('| ノベルティ | 3件 | セクション生成 |');
        expect(result).toContain('| グッズ | 0件 | スキップ |');

        // プレースホルダールールの確認
        expect(result).toContain('`{ここにメニューの画像を入れる}`');
        expect(result).toContain('`{ここにノベルティの画像を入れる}`');
        expect(result).toContain('`{ここにグッズの画像を入れる}`');
      });
    });
  });
});
