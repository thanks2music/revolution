/**
 * PlaceholderExtractorService
 * テンプレートに基づいて情報源からプレースホルダー値を抽出するサービス
 */

import {
  TemplateDefinition,
  ExtractedData,
  ExtractionRequest,
  ValidationResult,
  ValidationError,
} from "@/lib/types/template";
import { ClaudeAPIService } from "./claude-api.service";

/**
 * プレースホルダー抽出サービス
 */
export class PlaceholderExtractorService {
  private claudeAPI: ClaudeAPIService;

  constructor(claudeAPI?: ClaudeAPIService) {
    this.claudeAPI = claudeAPI || new ClaudeAPIService();
  }

  /**
   * 情報源からプレースホルダー値を抽出
   * @param request 抽出リクエスト
   * @returns 抽出されたデータ
   */
  async extractPlaceholders(
    request: ExtractionRequest
  ): Promise<ExtractedData> {
    try {
      // プロンプトを構築
      const prompt = this.buildExtractionPrompt(request);

      // Claude APIを呼び出し
      const response = await this.claudeAPI["client"].messages.create({
        model: this.claudeAPI["model"],
        max_tokens: 4000,
        temperature: 0.2, // 情報抽出は正確性を重視
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type from Claude API");
      }

      // レスポンスをパース
      const extractedData = this.parseExtractionResponse(content.text);

      console.log("Extracted data:", JSON.stringify(extractedData, null, 2));

      return extractedData;
    } catch (error) {
      console.error("Failed to extract placeholders:", error);
      throw new Error(
        `プレースホルダー抽出失敗: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * 抽出されたデータを検証
   * @param template テンプレート定義
   * @param extractedData 抽出されたデータ
   * @returns 検証結果
   */
  validateExtractedData(
    template: TemplateDefinition,
    extractedData: ExtractedData
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // 必須フィールドのチェック
    for (const requiredField of template.validation.required_fields) {
      const value = this.getNestedValue(extractedData, requiredField);

      if (value === null || value === undefined || value === "") {
        errors.push({
          field: requiredField,
          message: `必須フィールド「${requiredField}」が見つかりません`,
          type: "required",
        });
      }
    }

    // フォーマット検証
    for (const rule of template.validation.format_rules) {
      const value = this.getNestedValue(extractedData, rule.field);

      if (value !== null && value !== undefined && value !== "") {
        const regex = new RegExp(rule.pattern);
        if (!regex.test(String(value))) {
          errors.push({
            field: rule.field,
            message: rule.error_message,
            type: "format",
          });
        }
      }
    }

    // 型チェック（必須プレースホルダーのみ）
    for (const placeholder of template.placeholders.required) {
      const value = extractedData[placeholder.name];

      if (value !== null && value !== undefined) {
        const typeValid = this.validateType(value, placeholder.type);
        if (!typeValid) {
          errors.push({
            field: placeholder.name,
            message: `「${placeholder.name}」の型が不正です。期待される型: ${placeholder.type}`,
            type: "type",
          });
        }
      }
    }

    return {
      is_valid: errors.length === 0,
      errors,
    };
  }

  /**
   * ネストされたオブジェクトから値を取得
   * @param obj オブジェクト
   * @param path ドット区切りのパス（例: "開催期間.年"）
   * @returns 値
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split(".");
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return null;
      }
      value = value[key];
    }

    return value;
  }

  /**
   * 値の型を検証
   * @param value 値
   * @param expectedType 期待される型
   * @returns 型が一致する場合true
   */
  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return typeof value === "object" && !Array.isArray(value) && value !== null;
      default:
        return true;
    }
  }

  /**
   * プレースホルダー抽出用のプロンプトを構築
   * @param request 抽出リクエスト
   * @returns プロンプト文字列
   */
  private buildExtractionPrompt(request: ExtractionRequest): string {
    const { template, sourceUrl, sourceContent } = request;

    // プレースホルダー情報を整形
    const placeholderInfo = this.formatPlaceholderInfo(template);

    return `
あなたは情報抽出の専門家です。提供された情報源から、指定されたプレースホルダーの値を正確に抽出してください。

## プレースホルダー定義

### 必須項目
${placeholderInfo.required}

### オプション項目
${placeholderInfo.optional}

## 情報源URL
${sourceUrl}

## 情報源コンテンツ
${sourceContent}

## 抽出指示
${template.prompts.extraction_instruction}

## 重要
- 必ず上記の指示に従って、JSON形式のみで回答してください
- 情報が見つからない場合は必ずnullを返してください
- 推測で情報を補完しないでください
- 他のテキストは一切含めないでください
`;
  }

  /**
   * プレースホルダー情報を整形
   * @param template テンプレート定義
   * @returns 整形されたプレースホルダー情報
   */
  private formatPlaceholderInfo(template: TemplateDefinition): {
    required: string;
    optional: string;
  } {
    const required = template.placeholders.required
      .map((p) => {
        let info = `- **${p.name}** (${p.type})`;
        if (p.format) info += ` - フォーマット: ${p.format}`;
        if (p.example) info += ` - 例: ${JSON.stringify(p.example)}`;
        if (p.extraction_hint) info += `\n  ヒント: ${p.extraction_hint}`;
        if (p.properties) {
          info += "\n  プロパティ:";
          for (const [key, prop] of Object.entries(p.properties)) {
            info += `\n    - ${key}: ${prop.type}${prop.format ? ` (${prop.format})` : ""}`;
          }
        }
        return info;
      })
      .join("\n");

    const optional = template.placeholders.optional
      .map((p) => {
        let info = `- **${p.name}** (${p.type})`;
        if (p.format) info += ` - フォーマット: ${p.format}`;
        if (p.example) info += ` - 例: ${JSON.stringify(p.example)}`;
        if (p.extraction_hint) info += `\n  ヒント: ${p.extraction_hint}`;
        if (p.default !== undefined)
          info += ` - デフォルト: ${JSON.stringify(p.default)}`;
        return info;
      })
      .join("\n");

    return { required, optional };
  }

  /**
   * Claude APIからの抽出レスポンスをパース
   * @param response レスポンステキスト
   * @returns 抽出されたデータ
   */
  private parseExtractionResponse(response: string): ExtractedData {
    try {
      let extractedData: any;

      // JSONを抽出してパース
      try {
        extractedData = JSON.parse(response.trim());
      } catch (directParseError) {
        // マークダウンコードブロックから抽出を試みる
        const jsonMatch =
          response.match(/```json\n([\s\S]*?)\n```/) ||
          response.match(/```\n([\s\S]*?)\n```/) ||
          response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error("Could not parse extraction response:", response);
          throw new Error("No JSON found in extraction response");
        }

        extractedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      return extractedData as ExtractedData;
    } catch (error) {
      console.error("Failed to parse extraction response:", error);
      throw new Error(
        `Failed to parse extraction response: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * 抽出と検証を一括で実行
   * @param request 抽出リクエスト
   * @returns 抽出データと検証結果
   */
  async extractAndValidate(request: ExtractionRequest): Promise<{
    extractedData: ExtractedData;
    validationResult: ValidationResult;
  }> {
    const extractedData = await this.extractPlaceholders(request);
    const validationResult = this.validateExtractedData(
      request.template,
      extractedData
    );

    return {
      extractedData,
      validationResult,
    };
  }
}

/**
 * シングルトンインスタンス
 */
export const placeholderExtractorService = new PlaceholderExtractorService();
