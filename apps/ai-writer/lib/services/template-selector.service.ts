/**
 * TemplateSelectorService
 * RSS記事情報から最適なテンプレートを選択するサービス
 */

import {
  TemplateDefinition,
  TemplateSelectionRequest,
  TemplateSelectionResult,
} from "@/lib/types/template";
import { TemplateLoaderService } from "./template-loader-for-wordpress.service";
import { ClaudeAPIService } from "./claude-api.service";

/**
 * テンプレート選択結果（内部用）
 */
interface InternalSelectionResult extends TemplateSelectionResult {
  template: TemplateDefinition;
}

/**
 * テンプレート選択サービス
 */
export class TemplateSelectorService {
  private templateLoader: TemplateLoaderService;
  private claudeAPI: ClaudeAPIService;

  constructor(
    templateLoader?: TemplateLoaderService,
    claudeAPI?: ClaudeAPIService
  ) {
    this.templateLoader = templateLoader || new TemplateLoaderService();
    this.claudeAPI = claudeAPI || new ClaudeAPIService();
  }

  /**
   * RSS記事情報から最適なテンプレートを選択
   * @param request テンプレート選択リクエスト
   * @returns 選択されたテンプレート定義
   */
  async selectTemplate(
    request: TemplateSelectionRequest
  ): Promise<TemplateDefinition> {
    try {
      // すべてのテンプレートを読み込み
      const templates = await this.templateLoader.loadAllTemplates();

      if (templates.length === 0) {
        throw new Error("No templates available");
      }

      // 各テンプレートの適用可能性を評価
      const evaluations = await Promise.all(
        templates.map((template) => this.evaluateTemplate(template, request))
      );

      // フォールバック以外のテンプレートで最も適合度が高いものを選択
      const nonFallbackResults = evaluations.filter(
        (result) => !result.is_fallback
      );

      let selectedResult: InternalSelectionResult;

      if (nonFallbackResults.length > 0) {
        // 適合度順にソート
        nonFallbackResults.sort((a, b) => b.confidence - a.confidence);

        // 信頼度が十分に高いものを選択（閾値: 0.6）
        if (nonFallbackResults[0].confidence >= 0.6) {
          selectedResult = nonFallbackResults[0];
        } else {
          // 信頼度が低い場合はフォールバックテンプレートを使用
          const fallbackResult = evaluations.find(
            (result) => result.is_fallback
          );
          selectedResult =
            fallbackResult ||
            evaluations.sort((a, b) => b.confidence - a.confidence)[0];
        }
      } else {
        // フォールバックテンプレートを使用
        const fallbackResult = evaluations.find(
          (result) => result.is_fallback
        );
        selectedResult =
          fallbackResult ||
          evaluations.sort((a, b) => b.confidence - a.confidence)[0];
      }

      console.log("Selected template:", {
        id: selectedResult.template.template.id,
        name: selectedResult.template.template.name,
        confidence: selectedResult.confidence,
        reason: selectedResult.reason,
      });

      return selectedResult.template;
    } catch (error) {
      console.error("Failed to select template:", error);
      throw new Error(
        `テンプレート選択失敗: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * 特定のテンプレートの適用可能性を評価
   * @param template テンプレート定義
   * @param request 選択リクエスト
   * @returns 評価結果
   */
  private async evaluateTemplate(
    template: TemplateDefinition,
    request: TemplateSelectionRequest
  ): Promise<InternalSelectionResult> {
    try {
      // Claude APIに評価を依頼するプロンプトを構築
      const prompt = this.buildEvaluationPrompt(template, request);

      // Claude APIを呼び出し
      const response = await this.claudeAPI["client"].messages.create({
        model: this.claudeAPI["model"],
        max_tokens: 1000,
        temperature: 0.3, // 評価は確実性を重視
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
      const evaluationResult = this.parseEvaluationResponse(content.text);

      return {
        ...evaluationResult,
        template,
      };
    } catch (error) {
      console.error(
        `Failed to evaluate template ${template.template.id}:`,
        error
      );

      // エラー時は適用不可として返す
      return {
        is_applicable: false,
        confidence: 0,
        reason: `評価エラー: ${error instanceof Error ? error.message : "Unknown error"}`,
        matched_keywords: [],
        is_fallback: template.template.id === "common",
        template,
      };
    }
  }

  /**
   * テンプレート評価用のプロンプトを構築
   * @param template テンプレート定義
   * @param request 選択リクエスト
   * @returns プロンプト文字列
   */
  private buildEvaluationPrompt(
    template: TemplateDefinition,
    request: TemplateSelectionRequest
  ): string {
    return `
あなたはRSS記事から最適な記事テンプレートを選択する専門家です。

## テンプレート情報
- ID: ${template.template.id}
- 名前: ${template.template.name}
- 対応イベントタイプ: ${template.template.eventTypes.join("、")}

## テンプレート選択指示
${template.prompts.selection_instruction}

## RSS記事情報
- タイトル: ${request.title}
- URL: ${request.url}
- 本文抜粋: ${request.content.substring(0, 500)}...
${request.validationKeywords ? `- 検証キーワード: ${request.validationKeywords.join("、")}` : ""}

## 重要な指示
上記の情報を元に、このテンプレートが適用可能かを判定してください。
必ず以下のJSON形式のみで回答してください。他のテキストは一切含めないでください。

{
  "is_applicable": true または false,
  "confidence": 0.0 ~ 1.0 の数値（小数点1桁）,
  "reason": "判定理由の説明（日本語、1〜2文）",
  "matched_keywords": ["マッチしたキーワード1", "マッチしたキーワード2"],
  "is_fallback": ${template.template.id === "common" ? "true" : "false"}
}

## 判定基準
1. RSS記事のタイトルや本文に、テンプレートの対応イベントタイプに関するキーワードが含まれているか
2. 検証キーワードとテンプレートのイベントタイプが一致するか
3. 記事の内容がテンプレートの想定する形式に合致するか

confidence（信頼度）の目安:
- 0.9-1.0: 完全に一致、確実に適用可能
- 0.7-0.8: 高い確率で適用可能
- 0.5-0.6: 適用できる可能性がある
- 0.3-0.4: 適用できる可能性は低い
- 0.0-0.2: 適用不可
`;
  }

  /**
   * Claude APIからの評価レスポンスをパース
   * @param response レスポンステキスト
   * @returns 評価結果
   */
  private parseEvaluationResponse(response: string): TemplateSelectionResult {
    try {
      let evaluationData: any;

      // JSONを抽出してパース
      try {
        evaluationData = JSON.parse(response.trim());
      } catch (directParseError) {
        // マークダウンコードブロックから抽出を試みる
        const jsonMatch =
          response.match(/```json\n([\s\S]*?)\n```/) ||
          response.match(/```\n([\s\S]*?)\n```/) ||
          response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error("Could not parse evaluation response:", response);
          throw new Error("No JSON found in evaluation response");
        }

        evaluationData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      // 必須フィールドの検証
      if (typeof evaluationData.is_applicable !== "boolean") {
        throw new Error("Missing or invalid is_applicable field");
      }

      if (
        typeof evaluationData.confidence !== "number" ||
        evaluationData.confidence < 0 ||
        evaluationData.confidence > 1
      ) {
        throw new Error("Missing or invalid confidence field");
      }

      return {
        is_applicable: evaluationData.is_applicable,
        confidence: evaluationData.confidence,
        reason: evaluationData.reason || "理由なし",
        matched_keywords: evaluationData.matched_keywords || [],
        is_fallback: evaluationData.is_fallback || false,
      };
    } catch (error) {
      console.error("Failed to parse evaluation response:", error);
      throw new Error(
        `Failed to parse evaluation response: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * テンプレートIDで直接テンプレートを取得
   * @param templateId テンプレートID
   * @returns テンプレート定義
   */
  async getTemplateById(templateId: string): Promise<TemplateDefinition> {
    return this.templateLoader.loadTemplateById(templateId);
  }

  /**
   * 利用可能なテンプレート一覧を取得
   * @returns テンプレートメタデータのリスト
   */
  async getAvailableTemplates(): Promise<
    Array<{ id: string; name: string; eventTypes: string[] }>
  > {
    return this.templateLoader.getTemplateList();
  }
}

/**
 * シングルトンインスタンス
 */
export const templateSelectorService = new TemplateSelectorService();
