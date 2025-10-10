/**
 * TemplateLoaderService
 * YAMLテンプレートファイルを読み込み、パースするサービス
 */

import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { TemplateDefinition } from "@/lib/types/template";

/**
 * テンプレートローダーサービス
 */
export class TemplateLoaderService {
  /** テンプレートディレクトリのパス */
  private readonly templatesDir: string;

  /** ロード済みテンプレートのキャッシュ */
  private templateCache: Map<string, TemplateDefinition> = new Map();

  constructor(templatesDir?: string) {
    // デフォルトのテンプレートディレクトリ
    this.templatesDir =
      templatesDir ||
      path.join(
        process.cwd(),
        "..",
        "..",
        ".claude",
        "12-tools",
        "post-template-for-ai"
      );
  }

  /**
   * すべてのテンプレートを読み込む
   * @returns テンプレート定義の配列
   */
  async loadAllTemplates(): Promise<TemplateDefinition[]> {
    try {
      // テンプレートディレクトリ内のYAMLファイルを取得
      const files = await fs.readdir(this.templatesDir);
      const yamlFiles = files.filter(
        (file) => file.startsWith("post-template-") && file.endsWith(".yaml")
      );

      // 各YAMLファイルを読み込み
      const templates = await Promise.all(
        yamlFiles.map((file) => this.loadTemplate(file))
      );

      return templates;
    } catch (error) {
      console.error("Error loading templates:", error);
      throw new Error(`Failed to load templates: ${error}`);
    }
  }

  /**
   * 特定のテンプレートIDでテンプレートを読み込む
   * @param templateId テンプレートID
   * @returns テンプレート定義
   */
  async loadTemplateById(templateId: string): Promise<TemplateDefinition> {
    // キャッシュをチェック
    if (this.templateCache.has(templateId)) {
      return this.templateCache.get(templateId)!;
    }

    // ファイル名を構築（post-template-{id}.yaml）
    const filename = `post-template-${templateId}.yaml`;

    return this.loadTemplate(filename);
  }

  /**
   * テンプレートファイルを読み込む
   * @param filename ファイル名
   * @returns テンプレート定義
   */
  async loadTemplate(filename: string): Promise<TemplateDefinition> {
    try {
      const filepath = path.join(this.templatesDir, filename);

      // ファイルを読み込み
      const fileContent = await fs.readFile(filepath, "utf-8");

      // YAMLをパース
      const parsed = yaml.load(fileContent) as TemplateDefinition;

      // 基本的な検証
      this.validateTemplate(parsed, filename);

      // キャッシュに保存
      this.templateCache.set(parsed.template.id, parsed);

      return parsed;
    } catch (error) {
      console.error(`Error loading template file ${filename}:`, error);
      throw new Error(`Failed to load template ${filename}: ${error}`);
    }
  }

  /**
   * テンプレートの基本的な構造を検証
   * @param template テンプレート定義
   * @param filename ファイル名（エラーメッセージ用）
   */
  private validateTemplate(
    template: TemplateDefinition,
    filename: string
  ): void {
    // 必須フィールドのチェック
    if (!template.template) {
      throw new Error(
        `Template metadata is missing in ${filename}: template field is required`
      );
    }

    if (!template.template.id) {
      throw new Error(
        `Template ID is missing in ${filename}: template.id is required`
      );
    }

    if (!template.template.name) {
      throw new Error(
        `Template name is missing in ${filename}: template.name is required`
      );
    }

    if (!template.template.eventTypes || template.template.eventTypes.length === 0) {
      throw new Error(
        `Event types are missing in ${filename}: template.eventTypes must be a non-empty array`
      );
    }

    if (!template.placeholders) {
      throw new Error(
        `Placeholders are missing in ${filename}: placeholders field is required`
      );
    }

    if (!template.placeholders.required || !Array.isArray(template.placeholders.required)) {
      throw new Error(
        `Required placeholders are missing in ${filename}: placeholders.required must be an array`
      );
    }

    if (!template.templates) {
      throw new Error(
        `Templates are missing in ${filename}: templates field is required`
      );
    }

    if (!template.templates.main_content) {
      throw new Error(
        `Main content template is missing in ${filename}: templates.main_content is required`
      );
    }

    if (!template.prompts) {
      throw new Error(
        `Prompts are missing in ${filename}: prompts field is required`
      );
    }

    if (!template.prompts.extraction_instruction) {
      throw new Error(
        `Extraction instruction is missing in ${filename}: prompts.extraction_instruction is required`
      );
    }

    if (!template.prompts.rendering_instruction) {
      throw new Error(
        `Rendering instruction is missing in ${filename}: prompts.rendering_instruction is required`
      );
    }

    if (!template.prompts.selection_instruction) {
      throw new Error(
        `Selection instruction is missing in ${filename}: prompts.selection_instruction is required`
      );
    }

    if (!template.validation) {
      throw new Error(
        `Validation rules are missing in ${filename}: validation field is required`
      );
    }

    if (!template.validation.required_fields || !Array.isArray(template.validation.required_fields)) {
      throw new Error(
        `Required fields validation is missing in ${filename}: validation.required_fields must be an array`
      );
    }
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * テンプレート一覧を取得（メタデータのみ）
   * @returns テンプレートメタデータの配列
   */
  async getTemplateList(): Promise<
    Array<{ id: string; name: string; eventTypes: string[] }>
  > {
    const templates = await this.loadAllTemplates();
    return templates.map((t) => ({
      id: t.template.id,
      name: t.template.name,
      eventTypes: t.template.eventTypes,
    }));
  }

  /**
   * テンプレートが存在するかチェック
   * @param templateId テンプレートID
   * @returns 存在する場合true
   */
  async templateExists(templateId: string): Promise<boolean> {
    try {
      await this.loadTemplateById(templateId);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const templateLoaderService = new TemplateLoaderService();
