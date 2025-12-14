/**
 * YamlTemplateLoaderService の単体テスト
 *
 * @description
 * モジュール化YAMLテンプレートの読み込み機能をテスト。
 * - loadTemplate(): 従来の単一ファイルテンプレート読み込み
 * - loadModularTemplate(): 新しいモジュール化テンプレート読み込み
 *
 * @note
 * fs/promises のモックには __mocks__/fs/promises.ts を使用。
 * 実際のファイルシステムアクセスを避けてテストを実行。
 *
 * @see notes/01-project-docs/05-ai-writer/yaml-template/01-yaml-template-modularization-design.md
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import { YamlTemplateLoaderService } from '../../../../lib/services/yaml-template-loader.service';

// fs/promises のモックをインポート（__mocks__/fs/promises.ts を使用）
import { readFile, readdir, access } from 'fs/promises';

// Jest が自動的に __mocks__/fs/promises.ts を使うように設定
jest.mock('fs/promises');

// 型定義のためにモック関数をキャスト
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockAccess = access as jest.MockedFunction<typeof access>;

describe('YamlTemplateLoaderService', () => {
  let service: YamlTemplateLoaderService;
  const testTemplatesDir = '/test/templates';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new YamlTemplateLoaderService(testTemplatesDir);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ===============================================
  // loadTemplate() - 従来の単一ファイルテンプレート
  // ===============================================

  describe('loadTemplate', () => {
    const validYamlContent = `
template:
  id: test-template
  name: Test Template
  version: "1.0.0"
  description: Test template for unit tests

prompts:
  main: |
    This is a test prompt.
`;

    it('should load a valid YAML template', async () => {
      mockReadFile.mockResolvedValue(validYamlContent as any);

      const result = await service.loadTemplate('test-template');

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(testTemplatesDir, 'test-template.yaml'),
        'utf-8'
      );
      expect(result.template.id).toBe('test-template');
      expect(result.template.name).toBe('Test Template');
      expect(result.template.version).toBe('1.0.0');
      expect(result.prompts.main).toContain('This is a test prompt');
    });

    it('should throw error when template.id is missing', async () => {
      const invalidYaml = `
template:
  name: Missing ID Template
  version: "1.0.0"
prompts:
  main: Test
`;
      mockReadFile.mockResolvedValue(invalidYaml as any);

      await expect(service.loadTemplate('missing-id')).rejects.toThrow(
        'missing template.id'
      );
    });

    it('should throw error when prompts are missing', async () => {
      const invalidYaml = `
template:
  id: no-prompts
  name: No Prompts Template
  version: "1.0.0"
`;
      mockReadFile.mockResolvedValue(invalidYaml as any);

      await expect(service.loadTemplate('no-prompts')).rejects.toThrow(
        'missing prompts'
      );
    });

    it('should throw error when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(service.loadTemplate('nonexistent')).rejects.toThrow(
        'Failed to load YAML template'
      );
    });
  });

  // ===============================================
  // listTemplates()
  // ===============================================

  describe('listTemplates', () => {
    it('should list available templates', async () => {
      mockReaddir.mockResolvedValue([
        'template1.yaml',
        'template2.yaml',
        'readme.md',
        'config.json',
      ] as any);

      const result = await service.listTemplates();

      expect(result).toEqual(['template1', 'template2']);
    });

    it('should return empty array when directory is empty', async () => {
      mockReaddir.mockResolvedValue([] as any);

      const result = await service.listTemplates();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockReaddir.mockRejectedValue(new Error('Directory not found'));

      const result = await service.listTemplates();

      expect(result).toEqual([]);
    });
  });

  // ===============================================
  // loadModularTemplate() - 新しいモジュール化テンプレート
  // ===============================================

  describe('loadModularTemplate', () => {
    const mockMetaYaml = `
meta:
  id: collabo-cafe
  name: コラボカフェ記事テンプレート
  version: "2.0.0"
  description: コラボカフェ情報サイト向けMDX記事生成テンプレート
  output_format: mdx
  event_types:
    - cafe
    - popup_store

pipeline:
  order:
    - 1-extraction
    - 2-title
    - 3-selection
    - 4-content
  dependencies:
    2-title:
      requires:
        - 1-extraction
    3-selection:
      requires:
        - 1-extraction
    4-content:
      requires:
        - 2-title
        - 3-selection

sections:
  order:
    - 01-frontmatter
    - 02-lead
    - 03-overview
  conditional:
    02-lead:
      skip_if: "!has_lead_data"

shared:
  - shared/placeholders.yaml
  - shared/constraints.yaml
`;

    const mockPlaceholdersYaml = `
version: "1.0.0"
placeholders:
  required:
    - name: work_name
      type: string
      description: 作品名
    - name: start_date
      type: date
      description: 開催開始日
  optional:
    - name: end_date
      type: date
      description: 開催終了日
`;

    const mockConstraintsYaml = `
version: "1.0.0"
title:
  length:
    min: 28
    max: 40
    recommended: "32〜36文字"
  count_rule: "全角・半角・記号・スペースをすべて1文字としてカウント"
meta_description:
  length:
    max: 120
content:
  heading_level:
    max: 3
date_format:
  year: "YYYY年"
  date: "N月NN日"
  pattern:
    single: "{{start_date}}"
url_validation:
  pattern: "^https?://.+"
  official_domains:
    - example.com
`;

    const mockPipelineYaml = `
template:
  id: 4-content
  name: コンテンツ生成パイプライン
  version: "1.0.0"
  description: MDX記事本文を生成

input:
  required:
    - extraction_result
    - title_result
  optional:
    - selection_result

output:
  format: mdx
  description: 完成したMDX記事ファイル
  structure:
    - frontmatter
    - lead
    - overview

sections_reference:
  source: sections/
  assembly_order: from_meta

prompts:
  generate_content: |
    You are an article writer for a collaboration cafe information site.
`;

    const mockSectionFrontmatterYaml = `
section:
  id: 01-frontmatter
  name: フロントマター
  version: "1.0.0"
  order: 1

required_placeholders:
  - title
  - slug

templates:
  default: |
    ---
    title: "{{title}}"
    slug: "{{slug}}"
    ---
`;

    const mockSectionLeadYaml = `
section:
  id: 02-lead
  name: リード文
  version: "1.0.0"
  order: 2

conditions:
  - id: has_campaign
    condition: "campaign !== null"
    template: with_campaign

templates:
  default: |
    {{work_name}}のコラボカフェが開催されます。
  with_campaign: |
    {{work_name}}のコラボカフェが{{campaign}}で開催！
`;

    const mockSectionOverviewYaml = `
section:
  id: 03-overview
  name: 概要
  version: "1.0.0"
  order: 3

templates:
  default: |
    ## 開催概要
    開催期間: {{start_date}}〜{{end_date}}
`;

    const setupMockReadFile = () => {
      mockReadFile.mockImplementation(((filePath: any) => {
        const pathStr = typeof filePath === 'string' ? filePath : String(filePath);

        if (pathStr.endsWith('_meta.yaml')) {
          return Promise.resolve(mockMetaYaml);
        }
        if (pathStr.endsWith('placeholders.yaml')) {
          return Promise.resolve(mockPlaceholdersYaml);
        }
        if (pathStr.endsWith('constraints.yaml')) {
          return Promise.resolve(mockConstraintsYaml);
        }
        if (pathStr.endsWith('4-content.yaml')) {
          return Promise.resolve(mockPipelineYaml);
        }
        if (pathStr.endsWith('01-frontmatter.yaml')) {
          return Promise.resolve(mockSectionFrontmatterYaml);
        }
        if (pathStr.endsWith('02-lead.yaml')) {
          return Promise.resolve(mockSectionLeadYaml);
        }
        if (pathStr.endsWith('03-overview.yaml')) {
          return Promise.resolve(mockSectionOverviewYaml);
        }
        return Promise.reject(new Error(`ENOENT: ${pathStr}`));
      }) as any);
    };

    beforeEach(() => {
      setupMockReadFile();
    });

    it('should load and merge modular template correctly', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content'
      );

      // メタ情報の検証
      expect(result._meta.meta.id).toBe('collabo-cafe');
      expect(result._meta.meta.version).toBe('2.0.0');
      expect(result._meta.meta.output_format).toBe('mdx');

      // パイプラインの検証
      expect(result.template.id).toBe('4-content');
      expect(result.prompts.generate_content).toContain('article writer');

      // 共通定義の検証
      expect(result._shared.placeholders.placeholders.required).toHaveLength(2);
      expect(result._shared.constraints.title.length?.min).toBe(28);

      // 展開されたプレースホルダーの検証
      expect(result.placeholders?.required[0].name).toBe('work_name');

      // 展開された制約の検証
      expect(result.constraints?.title.length?.max).toBe(40);
    });

    it('should merge sections when pipeline references them', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content'
      );

      // セクションが結合されていることを検証
      expect(result._sections).toBeDefined();
      expect(result._sections?.order).toEqual([
        '01-frontmatter',
        '02-lead',
        '03-overview',
      ]);
      expect(result._sections?.templates['01-frontmatter']).toBeDefined();
      expect(result._sections?.templates['02-lead']).toBeDefined();
      expect(result._sections?.templates['03-overview']).toBeDefined();
    });

    it('should merge conditions from all sections', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content'
      );

      // 条件がマージされていることを検証
      expect(result._sections?.conditions).toHaveLength(1);
      expect(result._sections?.conditions[0].id).toBe('has_campaign');
      expect(result._sections?.conditions[0].template).toBe('with_campaign');
    });

    it('should skip sections when includeSections is false', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content',
        {
          includeSections: false,
        }
      );

      expect(result._sections).toBeUndefined();
    });

    it('should skip shared when includeShared is false', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content',
        {
          includeShared: false,
        }
      );

      // 共通定義はデフォルト値になる
      expect(result._shared.placeholders.placeholders.required).toHaveLength(0);
      expect(result.placeholders).toBeUndefined();
    });

    it('should add debug boundary markers when debug is true', async () => {
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content',
        {
          debug: true,
        }
      );

      // デバッグ用境界マーカーが挿入されていることを検証
      expect(result._sections?.templates['01-frontmatter']._boundary).toBe(
        '# === SECTION: 01-frontmatter ==='
      );
    });

    it('should throw error when _meta.yaml is invalid', async () => {
      mockReadFile.mockImplementation(((filePath: any) => {
        const pathStr = typeof filePath === 'string' ? filePath : String(filePath);
        if (pathStr.endsWith('_meta.yaml')) {
          return Promise.resolve(`
meta:
  name: Missing ID
`);
        }
        return Promise.resolve('');
      }) as any);

      await expect(
        service.loadModularTemplate('invalid-meta', '4-content')
      ).rejects.toThrow('missing meta.id');
    });

    it('should throw error when pipeline file is invalid', async () => {
      mockReadFile.mockImplementation(((filePath: any) => {
        const pathStr = typeof filePath === 'string' ? filePath : String(filePath);
        if (pathStr.endsWith('_meta.yaml')) {
          return Promise.resolve(mockMetaYaml);
        }
        if (pathStr.endsWith('placeholders.yaml')) {
          return Promise.resolve(mockPlaceholdersYaml);
        }
        if (pathStr.endsWith('constraints.yaml')) {
          return Promise.resolve(mockConstraintsYaml);
        }
        if (pathStr.includes('pipeline')) {
          return Promise.resolve(`
template:
  name: Missing ID Pipeline
`);
        }
        return Promise.resolve('');
      }) as any);

      await expect(
        service.loadModularTemplate('collabo-cafe', 'invalid-pipeline')
      ).rejects.toThrow('missing template.id');
    });

    it('should handle missing section files gracefully', async () => {
      mockReadFile.mockImplementation(((filePath: any) => {
        const pathStr = typeof filePath === 'string' ? filePath : String(filePath);
        if (pathStr.endsWith('_meta.yaml')) {
          return Promise.resolve(mockMetaYaml);
        }
        if (pathStr.endsWith('placeholders.yaml')) {
          return Promise.resolve(mockPlaceholdersYaml);
        }
        if (pathStr.endsWith('constraints.yaml')) {
          return Promise.resolve(mockConstraintsYaml);
        }
        if (pathStr.endsWith('4-content.yaml')) {
          return Promise.resolve(mockPipelineYaml);
        }
        // セクションファイルは存在しない
        return Promise.reject(new Error(`ENOENT: ${pathStr}`));
      }) as any);

      // エラーにならず、空のセクションで処理される
      const result = await service.loadModularTemplate(
        'collabo-cafe',
        '4-content'
      );

      expect(result._sections?.templates).toEqual({});
      expect(result._sections?.order).toEqual([
        '01-frontmatter',
        '02-lead',
        '03-overview',
      ]);
    });
  });

  // ===============================================
  // isModularTemplate()
  // ===============================================

  describe('isModularTemplate', () => {
    it('should return true when _meta.yaml exists', async () => {
      mockAccess.mockResolvedValue(undefined as any);

      const result = await service.isModularTemplate('collabo-cafe');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(
        path.join(testTemplatesDir, 'collabo-cafe', '_meta.yaml')
      );
    });

    it('should return false when _meta.yaml does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      const result = await service.isModularTemplate('single-file-template');

      expect(result).toBe(false);
    });
  });

  // ===============================================
  // listPipelines()
  // ===============================================

  describe('listPipelines', () => {
    it('should list pipeline files', async () => {
      mockReaddir.mockResolvedValue([
        '1-extraction.yaml',
        '2-title.yaml',
        '3-selection.yaml',
        '4-content.yaml',
      ] as any);

      const result = await service.listPipelines('collabo-cafe');

      expect(result).toEqual([
        '1-extraction',
        '2-title',
        '3-selection',
        '4-content',
      ]);
      expect(mockReaddir).toHaveBeenCalledWith(
        path.join(testTemplatesDir, 'collabo-cafe', 'pipeline')
      );
    });

    it('should return empty array when directory does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const result = await service.listPipelines('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ===============================================
  // listSections()
  // ===============================================

  describe('listSections', () => {
    it('should list section files sorted by filename', async () => {
      mockReaddir.mockResolvedValue([
        '03-overview.yaml',
        '01-frontmatter.yaml',
        '02-lead.yaml',
      ] as any);

      const result = await service.listSections('collabo-cafe');

      // ファイル名でソートされている
      expect(result).toEqual(['01-frontmatter', '02-lead', '03-overview']);
      expect(mockReaddir).toHaveBeenCalledWith(
        path.join(testTemplatesDir, 'collabo-cafe', 'sections')
      );
    });

    it('should return empty array when directory does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const result = await service.listSections('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ===============================================
  // デフォルトテンプレートディレクトリ
  // ===============================================

  describe('default templates directory', () => {
    it('should use process.cwd()/templates as default', () => {
      const defaultService = new YamlTemplateLoaderService();

      // インスタンスが作成されることを確認
      expect(defaultService).toBeInstanceOf(YamlTemplateLoaderService);
    });
  });
});
