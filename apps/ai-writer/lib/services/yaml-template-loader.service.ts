/**
 * YAML Template Loader Service
 * 記事生成用のYAMLテンプレートを読み込むサービス
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * YAML テンプレートの基本構造
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
  [key: string]: any; // その他のフィールドを許容
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

  /**
   * テンプレートIDからYAMLファイルを読み込む
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
}

/**
 * シングルトンインスタンス
 */
export const yamlTemplateLoaderService = new YamlTemplateLoaderService();
