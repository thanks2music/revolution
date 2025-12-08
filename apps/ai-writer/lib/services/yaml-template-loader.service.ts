/**
 * YAML Template Loader Service
 * 記事生成用のYAMLテンプレートを読み込むサービス
 *
 * @description
 * 単一ファイルテンプレート（従来）とモジュール化テンプレート（新）の両方に対応。
 * モジュール化テンプレートは loadModularTemplate() で読み込む。
 *
 * @see notes/01-project-docs/05-ai-writer/yaml-template/01-yaml-template-modularization-design.md
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type {
  MetaConfig,
  MergedModularTemplate,
  MergedShared,
  MergedSections,
  SharedPlaceholders,
  SharedConstraints,
  PipelineTemplate,
  SectionTemplate,
  SectionCondition,
  LoadModularTemplateOptions,
} from '@/lib/types/modular-template';

/**
 * YAML テンプレートの基本構造（従来の単一ファイル用）
 */
export interface YamlTemplate {
  template: {
    id: string;
    name: string;
    version: string;
    description?: string;
  };
  placeholders?: {
    required?: Array<{ name: string; type: string; description: string }>;
    optional?: Array<{ name: string; type: string; description: string }>;
  };
  logic?: Record<string, string>;
  output?: {
    format: string;
    description?: string;
    schema?: string;
  };
  prompts: Record<string, string>;
  [key: string]: unknown; // その他のフィールドを許容
}

/**
 * YAML Template Loader Service
 */
export class YamlTemplateLoaderService {
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    // デフォルトは apps/ai-writer/templates
    this.templatesDir =
      templatesDir || path.join(process.cwd(), 'templates');
  }

  // ===============================================
  // 従来の単一ファイルテンプレート読み込み
  // ===============================================

  /**
   * テンプレートIDからYAMLファイルを読み込む（従来方式）
   * @param templateId テンプレートID（例: "collabo-cafe-selection"）
   * @returns パースされたYAMLテンプレート
   */
  async loadTemplate(templateId: string): Promise<YamlTemplate> {
    try {
      const filePath = path.join(this.templatesDir, `${templateId}.yaml`);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const parsed = yaml.load(fileContent) as YamlTemplate;

      // 必須フィールドの検証
      if (!parsed.template || !parsed.template.id) {
        throw new Error(`Invalid template structure in ${templateId}.yaml: missing template.id`);
      }

      if (!parsed.prompts || Object.keys(parsed.prompts).length === 0) {
        throw new Error(`Invalid template structure in ${templateId}.yaml: missing prompts`);
      }

      console.log(`[YamlTemplateLoader] Loaded template: ${parsed.template.name} (v${parsed.template.version})`);

      return parsed;
    } catch (error) {
      console.error(`[YamlTemplateLoader] Failed to load template ${templateId}:`, error);
      throw new Error(
        `Failed to load YAML template "${templateId}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 利用可能なテンプレート一覧を取得
   * @returns テンプレートIDの配列
   */
  async listTemplates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.templatesDir);
      const yamlFiles = files.filter((file) => file.endsWith('.yaml'));
      return yamlFiles.map((file) => file.replace('.yaml', ''));
    } catch (error) {
      console.error('[YamlTemplateLoader] Failed to list templates:', error);
      return [];
    }
  }

  // ===============================================
  // モジュール化テンプレート読み込み（新方式）
  // ===============================================

  /**
   * モジュール化されたテンプレートを結合して読み込む
   *
   * @description
   * ディレクトリ構造:
   *   {templateId}/
   *     ├── _meta.yaml
   *     ├── shared/
   *     ├── pipeline/
   *     └── sections/
   *
   * @param templateId テンプレートID（例: "collabo-cafe"）
   * @param pipelineId パイプラインID（例: "4-content"）
   * @param options 読み込みオプション
   * @returns 結合済みYAMLテンプレート
   */
  async loadModularTemplate(
    templateId: string,
    pipelineId: string,
    options: LoadModularTemplateOptions = {}
  ): Promise<MergedModularTemplate> {
    const {
      includeSections = true,
      includeShared = true,
      debug = false,
    } = options;

    try {
      console.log(`[YamlTemplateLoader] Loading modular template: ${templateId}/${pipelineId}`);

      // 1. _meta.yaml を読み込み
      const meta = await this.loadMeta(templateId);

      // 2. shared/ 配下のファイルを読み込み・マージ
      let shared: MergedShared | undefined;
      if (includeShared) {
        shared = await this.loadSharedFiles(templateId, meta);
      }

      // 3. 指定されたパイプラインファイルを読み込み
      const pipeline = await this.loadPipeline(templateId, pipelineId);

      // 4. パイプラインが sections を参照する場合、sections を結合
      let sections: MergedSections | undefined;
      if (includeSections && pipeline.sections_reference) {
        sections = await this.loadAndMergeSections(templateId, meta, debug);
      }

      // 5. 全体を結合して返却
      const merged = this.mergeTemplates(meta, shared, pipeline, sections);

      console.log(
        `[YamlTemplateLoader] Loaded modular template: ${merged.template.name} (v${merged.template.version})`
      );

      return merged;
    } catch (error) {
      console.error(
        `[YamlTemplateLoader] Failed to load modular template ${templateId}/${pipelineId}:`,
        error
      );
      throw new Error(
        `Failed to load modular YAML template "${templateId}/${pipelineId}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * _meta.yaml を読み込む
   */
  private async loadMeta(templateId: string): Promise<MetaConfig> {
    const metaPath = path.join(this.templatesDir, templateId, '_meta.yaml');
    const content = await this.loadYamlFile(metaPath);

    // 必須フィールドの検証
    if (!content.meta?.id) {
      throw new Error(`Invalid _meta.yaml in ${templateId}: missing meta.id`);
    }
    if (!content.pipeline?.order) {
      throw new Error(`Invalid _meta.yaml in ${templateId}: missing pipeline.order`);
    }
    if (!content.sections?.order) {
      throw new Error(`Invalid _meta.yaml in ${templateId}: missing sections.order`);
    }

    return content as MetaConfig;
  }

  /**
   * shared/ 配下のファイルを読み込み・マージ
   */
  private async loadSharedFiles(
    templateId: string,
    meta: MetaConfig
  ): Promise<MergedShared> {
    const sharedDir = path.join(this.templatesDir, templateId, 'shared');

    // placeholders.yaml を読み込み
    const placeholdersPath = path.join(sharedDir, 'placeholders.yaml');
    let placeholders: SharedPlaceholders;
    try {
      placeholders = await this.loadYamlFile(placeholdersPath) as SharedPlaceholders;
    } catch {
      // ファイルが存在しない場合はデフォルト値
      placeholders = {
        version: '1.0.0',
        placeholders: { required: [], optional: [] },
      };
    }

    // constraints.yaml を読み込み
    const constraintsPath = path.join(sharedDir, 'constraints.yaml');
    let constraints: SharedConstraints;
    try {
      constraints = await this.loadYamlFile(constraintsPath) as SharedConstraints;
    } catch {
      // ファイルが存在しない場合はデフォルト値
      constraints = {
        version: '1.0.0',
        title: {},
        meta_description: {},
        content: {},
        date_format: { year: 'YYYY年', date: 'N月NN日', pattern: {} },
        url_validation: { pattern: '^https?://.+', official_domains: [] },
      };
    }

    return { placeholders, constraints };
  }

  /**
   * パイプラインファイルを読み込む
   */
  private async loadPipeline(
    templateId: string,
    pipelineId: string
  ): Promise<PipelineTemplate> {
    const pipelinePath = path.join(
      this.templatesDir,
      templateId,
      'pipeline',
      `${pipelineId}.yaml`
    );
    const content = await this.loadYamlFile(pipelinePath);

    // 必須フィールドの検証
    if (!content.template?.id) {
      throw new Error(`Invalid pipeline ${pipelineId}.yaml: missing template.id`);
    }
    if (!content.prompts || Object.keys(content.prompts).length === 0) {
      throw new Error(`Invalid pipeline ${pipelineId}.yaml: missing prompts`);
    }

    return content as PipelineTemplate;
  }

  /**
   * セクションファイルを順序通りに結合
   */
  private async loadAndMergeSections(
    templateId: string,
    meta: MetaConfig,
    debug: boolean = false
  ): Promise<MergedSections> {
    const sectionOrder = meta.sections.order;
    const sectionsDir = path.join(this.templatesDir, templateId, 'sections');

    const templates: Record<string, SectionTemplate> = {};
    const conditions: SectionCondition[] = [];

    for (const sectionId of sectionOrder) {
      const sectionPath = path.join(sectionsDir, `${sectionId}.yaml`);

      try {
        const section = await this.loadYamlFile(sectionPath) as SectionTemplate;

        // デバッグモードの場合、境界マーカーを挿入
        if (debug) {
          section._boundary = `# === SECTION: ${sectionId} ===`;
        }

        templates[sectionId] = section;

        // 条件をマージ
        if (section.conditions) {
          conditions.push(...section.conditions);
        }
      } catch (error) {
        console.warn(
          `[YamlTemplateLoader] Section ${sectionId}.yaml not found, skipping`
        );
      }
    }

    return {
      templates,
      conditions,
      order: sectionOrder,
    };
  }

  /**
   * 全コンポーネントを結合
   */
  private mergeTemplates(
    meta: MetaConfig,
    shared: MergedShared | undefined,
    pipeline: PipelineTemplate,
    sections: MergedSections | undefined
  ): MergedModularTemplate {
    const merged: MergedModularTemplate = {
      _meta: meta,
      _shared: shared || {
        placeholders: { version: '1.0.0', placeholders: { required: [], optional: [] } },
        constraints: {
          version: '1.0.0',
          title: {},
          meta_description: {},
          content: {},
          date_format: { year: 'YYYY年', date: 'N月NN日', pattern: {} },
          url_validation: { pattern: '^https?://.+', official_domains: [] },
        },
      },
      template: pipeline.template,
      prompts: pipeline.prompts,
    };

    // セクションがある場合は追加
    if (sections) {
      merged._sections = sections;
    }

    // パイプラインのフィールドを展開
    if (pipeline.input) {
      merged.input = pipeline.input;
    }
    if (pipeline.output) {
      merged.output = pipeline.output;
    }
    if (pipeline.logic) {
      merged.logic = pipeline.logic;
    }

    // パイプライン固有の追加フィールドを展開（rules, constraints, extraction_fields など）
    const additionalFields = ['rules', 'placeholders', 'derived_variables', 'extraction_fields'] as const;
    for (const field of additionalFields) {
      if (pipeline[field]) {
        (merged as any)[field] = pipeline[field];
      }
    }

    // shared から placeholders と constraints を展開（利便性のため）
    // パイプライン固有のフィールドがない場合のみ shared から取得
    if (shared) {
      if (!merged.placeholders) {
        merged.placeholders = shared.placeholders.placeholders;
      }
      merged.constraints = shared.constraints;
    }

    return merged;
  }

  // ===============================================
  // ユーティリティメソッド
  // ===============================================

  /**
   * YAMLファイルを読み込んでパース
   */
  private async loadYamlFile(filePath: string): Promise<Record<string, unknown>> {
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.load(content) as Record<string, unknown>;
  }

  /**
   * モジュール化テンプレートが存在するか確認
   */
  async isModularTemplate(templateId: string): Promise<boolean> {
    const metaPath = path.join(this.templatesDir, templateId, '_meta.yaml');
    try {
      await fs.access(metaPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * モジュール化テンプレートのパイプライン一覧を取得
   */
  async listPipelines(templateId: string): Promise<string[]> {
    const pipelineDir = path.join(this.templatesDir, templateId, 'pipeline');
    try {
      const files = await fs.readdir(pipelineDir);
      return files
        .filter((file) => file.endsWith('.yaml'))
        .map((file) => file.replace('.yaml', ''));
    } catch {
      return [];
    }
  }

  /**
   * モジュール化テンプレートのセクション一覧を取得
   */
  async listSections(templateId: string): Promise<string[]> {
    const sectionsDir = path.join(this.templatesDir, templateId, 'sections');
    try {
      const files = await fs.readdir(sectionsDir);
      return files
        .filter((file) => file.endsWith('.yaml'))
        .map((file) => file.replace('.yaml', ''))
        .sort(); // ファイル名プレフィックスで自然にソート
    } catch {
      return [];
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const yamlTemplateLoaderService = new YamlTemplateLoaderService();
