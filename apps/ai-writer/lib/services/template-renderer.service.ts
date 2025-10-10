/**
 * TemplateRendererService
 * テンプレートと抽出データを使って最終的な記事コンテンツをレンダリングするサービス
 */

import {
  TemplateDefinition,
  ExtractedData,
  RenderedContent,
  RenderingRequest,
} from "@/lib/types/template";
import { ClaudeAPIService } from "./claude-api.service";

/**
 * テンプレートレンダリングサービス
 */
export class TemplateRendererService {
  private claudeAPI: ClaudeAPIService;

  constructor(claudeAPI?: ClaudeAPIService) {
    this.claudeAPI = claudeAPI || new ClaudeAPIService();
  }

  /**
   * テンプレートをレンダリング
   * @param request レンダリングリクエスト
   * @returns レンダリング結果
   */
  async renderTemplate(request: RenderingRequest): Promise<RenderedContent> {
    try {
      // プロンプトを構築
      const prompt = this.buildRenderingPrompt(request);

      // Claude APIを呼び出し
      const response = await this.claudeAPI["client"].messages.create({
        model: this.claudeAPI["model"],
        max_tokens: 8000,
        temperature: 0.3, // レンダリングは適度な創造性
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
      const renderedContent = this.parseRenderingResponse(content.text);

      console.log("Rendered content:", {
        meta_description_length: renderedContent.meta_description.length,
        content_length: renderedContent.content.length,
      });

      return renderedContent;
    } catch (error) {
      console.error("Failed to render template:", error);
      throw new Error(
        `テンプレートレンダリング失敗: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * レンダリング用のプロンプトを構築
   * @param request レンダリングリクエスト
   * @returns プロンプト文字列
   */
  private buildRenderingPrompt(request: RenderingRequest): string {
    const { template, extractedData } = request;

    // テンプレート情報を整形
    const templateInfo = this.formatTemplateInfo(template);
    const dataInfo = this.formatDataInfo(extractedData);

    return `
あなたはテンプレートレンダリングの専門家です。提供されたテンプレートと抽出データを使って、最終的な記事コンテンツを生成してください。

## テンプレート情報
${templateInfo}

## 抽出されたデータ
${dataInfo}

## 条件分岐ルール
${this.formatConditions(template)}

## レンダリング指示
${template.prompts.rendering_instruction}

## 重要
- 必ず上記のレンダリング指示に従ってください
- 条件分岐を正しく処理してください
- プレースホルダーを抽出データで置換してください
- 最終的に以下のJSON形式のみで回答してください（他のテキストは一切含めないでください）

{
  "meta_description": "レンダリングされたメタディスクリプション",
  "content": "レンダリングされた記事本文(HTML)"
}
`;
  }

  /**
   * テンプレート情報を整形
   * @param template テンプレート定義
   * @returns 整形されたテンプレート情報
   */
  private formatTemplateInfo(template: TemplateDefinition): string {
    let info = `テンプレート名: ${template.template.name}\n`;
    info += `テンプレートID: ${template.template.id}\n\n`;
    info += "## 利用可能なテンプレート\n\n";

    for (const [key, value] of Object.entries(template.templates)) {
      info += `### ${key}\n\`\`\`\n${value}\n\`\`\`\n\n`;
    }

    return info;
  }

  /**
   * 抽出データを整形
   * @param data 抽出データ
   * @returns 整形されたデータ情報
   */
  private formatDataInfo(data: ExtractedData): string {
    return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
  }

  /**
   * 条件分岐ルールを整形
   * @param template テンプレート定義
   * @returns 整形された条件分岐情報
   */
  private formatConditions(template: TemplateDefinition): string {
    let info = "";

    for (const [key, rules] of Object.entries(template.conditions)) {
      if (!rules) continue;

      info += `\n### ${key}の条件分岐\n`;
      rules.forEach((rule, index) => {
        info += `${index + 1}. 条件: ${rule.condition}\n`;
        info += `   使用テンプレート: ${rule.use_template}\n`;
      });
    }

    return info || "条件分岐なし";
  }

  /**
   * Claude APIからのレンダリングレスポンスをパース
   * @param response レスポンステキスト
   * @returns レンダリング結果
   */
  private parseRenderingResponse(response: string): RenderedContent {
    try {
      // デバッグ用: 生のレスポンスをログ出力
      console.log("\n=== Claude Raw Rendering Response ===");
      console.log(response.substring(0, 500) + "...");
      console.log("=== End Raw Response ===\n");

      let renderedData: any;

      // JSONを抽出してパース
      try {
        renderedData = JSON.parse(response.trim());
        console.log("✅ Direct JSON parse succeeded");
      } catch (directParseError) {
        console.log("⚠️ Direct JSON parse failed, trying extraction...");

        // Strategy 1: マークダウンコードブロックから抽出
        let jsonMatch =
          response.match(/```json\s*\n([\s\S]*?)\n```/) ||
          response.match(/```\s*\n([\s\S]*?)\n```/);

        if (jsonMatch) {
          console.log("Found JSON in markdown code block");
          try {
            const jsonText = this.cleanJsonString(jsonMatch[1]);
            renderedData = JSON.parse(jsonText);
            console.log("✅ Markdown code block parse succeeded");
          } catch (e) {
            console.log("❌ Markdown code block parse failed:", e);
          }
        }

        // Strategy 2: JSON objectの最初と最後を見つける
        if (!renderedData) {
          const firstBrace = response.indexOf("{");
          const lastBrace = response.lastIndexOf("}");

          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const jsonText = response.substring(firstBrace, lastBrace + 1);
            console.log("Found JSON object by brace matching");
            try {
              const cleanedJson = this.cleanJsonString(jsonText);
              renderedData = JSON.parse(cleanedJson);
              console.log("✅ Brace matching parse succeeded");
            } catch (e) {
              console.log("❌ Brace matching parse failed:", e);
            }
          }
        }

        if (!renderedData) {
          console.error("❌ All JSON extraction strategies failed");
          console.error("Full response:", response);
          throw new Error("No valid JSON found in rendering response");
        }
      }

      // 必須フィールドの検証
      if (!renderedData.meta_description) {
        throw new Error("Missing meta_description in rendered content");
      }

      if (!renderedData.content) {
        throw new Error("Missing content in rendered content");
      }

      return {
        meta_description: renderedData.meta_description,
        content: renderedData.content,
      };
    } catch (error) {
      console.error("Failed to parse rendering response:", error);
      throw new Error(
        `Failed to parse rendering response: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * JSON文字列をクリーンアップ（一般的なエラーを修正）
   * フェーズ3改良版: 文字単位で未エスケープのダブルクォートを検出・修正
   * @param jsonText JSON文字列
   * @returns クリーンアップされたJSON文字列
   */
  private cleanJsonString(jsonText: string): string {
    let cleaned = jsonText.trim();

    try {
      // まずJSONとしてパース試行（成功すればそのまま返す）
      JSON.parse(cleaned);
      console.log("✨ JSON already valid, no cleaning needed");
      return cleaned;
    } catch (e) {
      // パース失敗 → クリーニング実行
      console.log("🔧 JSON needs cleaning, applying sanitization...");
    }

    // 戦略: JSON文字列を文字単位で走査し、フィールド値内の未エスケープ"を\"に変換
    const result: string[] = [];
    let i = 0;
    let inStringValue = false;
    let currentFieldName = '';
    let isFieldValue = false;

    while (i < cleaned.length) {
      const char = cleaned[i];
      const nextChar = cleaned[i + 1];

      // エスケープシーケンス処理（既にエスケープされている場合はそのまま）
      if (char === '\\' && (nextChar === '"' || nextChar === '\\' || nextChar === 'n')) {
        result.push(char);
        result.push(nextChar);
        i += 2;
        continue;
      }

      // ダブルクォート検出
      if (char === '"') {
        // フィールド名または値の開始/終了を判定
        if (!inStringValue) {
          // 文字列開始
          inStringValue = true;

          // 直前の文字を確認してフィールド値かどうか判定
          // ": "の後なら値、それ以外ならフィールド名
          const prevNonWhitespace = this.findPrevNonWhitespace(cleaned, i - 1);
          isFieldValue = (prevNonWhitespace === ':');

          result.push(char);
        } else {
          // 文字列終了の可能性
          // 次の文字が , } ] のいずれかなら終了、それ以外なら値内の"（エスケープ必要）
          const nextNonWhitespace = this.findNextNonWhitespace(cleaned, i + 1);

          if (isFieldValue && nextNonWhitespace !== ',' && nextNonWhitespace !== '}' && nextNonWhitespace !== null) {
            // 値内の未エスケープ" → \"に変換
            result.push('\\');
            result.push('"');
            console.log(`  Fixed unescaped " at position ${i}`);
          } else {
            // 正常な文字列終了
            inStringValue = false;
            isFieldValue = false;
            result.push(char);
          }
        }
      } else {
        result.push(char);
      }

      i++;
    }

    const sanitized = result.join('');

    // 検証: サニタイズ後のJSONが有効か確認
    try {
      JSON.parse(sanitized);
      console.log("✅ JSON sanitization successful");
      return sanitized;
    } catch (e) {
      console.warn("⚠️ Sanitized JSON still invalid, returning original");
      return cleaned;
    }
  }

  /**
   * 指定位置から前方向に空白以外の文字を探す
   */
  private findPrevNonWhitespace(str: string, startPos: number): string | null {
    for (let i = startPos; i >= 0; i--) {
      if (!/\s/.test(str[i])) {
        return str[i];
      }
    }
    return null;
  }

  /**
   * 指定位置から後方向に空白以外の文字を探す
   */
  private findNextNonWhitespace(str: string, startPos: number): string | null {
    for (let i = startPos; i < str.length; i++) {
      if (!/\s/.test(str[i])) {
        return str[i];
      }
    }
    return null;
  }

  /**
   * 簡易的なプレースホルダー置換（Claude APIを使わない場合）
   * @param template テンプレート文字列
   * @param data 抽出データ
   * @returns 置換後の文字列
   */
  private simpleReplace(template: string, data: ExtractedData): string {
    let result = template;

    // {{変数名}} 形式のプレースホルダーを置換
    const placeholderRegex = /\{\{([^}]+)\}\}/g;

    result = result.replace(placeholderRegex, (match, placeholder) => {
      const trimmed = placeholder.trim();

      // ドット記法対応（例: {{開催期間.年}}）
      if (trimmed.includes(".")) {
        const keys = trimmed.split(".");
        let value: any = data;

        for (const key of keys) {
          if (value && typeof value === "object") {
            value = value[key];
          } else {
            value = null;
            break;
          }
        }

        return value !== null && value !== undefined ? String(value) : match;
      }

      // 単純な置換
      const value = data[trimmed];
      return value !== null && value !== undefined ? String(value) : match;
    });

    return result;
  }

  /**
   * 条件評価（簡易版）
   * @param condition 条件文字列
   * @param data 抽出データ
   * @returns 条件が真の場合true
   */
  private evaluateCondition(condition: string, data: ExtractedData): boolean {
    // 「が存在する」パターン
    if (condition.includes("が存在する")) {
      const fieldName = condition.replace("が存在する", "").trim();
      const value = data[fieldName];
      return (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0)
      );
    }

    // 「が存在しない」パターン
    if (condition.includes("が存在しない")) {
      const fieldName = condition.replace("が存在しない", "").trim();
      const value = data[fieldName];
      return (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    }

    // 「== true」パターン
    if (condition.includes("== true")) {
      const fieldName = condition.replace("== true", "").trim();
      return data[fieldName] === true;
    }

    // 「== false」パターン
    if (condition.includes("== false")) {
      const fieldName = condition.replace("== false", "").trim();
      return data[fieldName] === false;
    }

    // AND条件
    if (condition.includes("AND")) {
      const parts = condition.split("AND").map((p) => p.trim());
      return parts.every((part) => this.evaluateCondition(part, data));
    }

    // デフォルト: false
    return false;
  }

  /**
   * 条件に基づいてテンプレートを選択
   * @param template テンプレート定義
   * @param conditionKey 条件キー（例: "meta_description"）
   * @param data 抽出データ
   * @returns 選択されたテンプレート名
   */
  selectTemplateByCondition(
    template: TemplateDefinition,
    conditionKey: string,
    data: ExtractedData
  ): string | null {
    const rules = template.conditions[conditionKey];

    if (!rules) {
      return null;
    }

    for (const rule of rules) {
      if (this.evaluateCondition(rule.condition, data)) {
        return rule.use_template;
      }
    }

    return null;
  }
}

/**
 * シングルトンインスタンス
 */
export const templateRendererService = new TemplateRendererService();
