/**
 * Title Generation Service
 * YAML テンプレートを使用してコラボカフェ記事のタイトルを生成するサービス
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 */

import {
  TitleGenerationRequest,
  TitleGenerationResult,
} from '@/lib/types/title-generation';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';

/**
 * タイトル生成サービス
 */
export class TitleGenerationService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  private readonly templateId = 'post-template-collabo-cafe-title';

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * RSS記事からタイトルを生成
   * @param request タイトル生成リクエスト
   * @returns 生成されたタイトル
   */
  async generateTitle(
    request: TitleGenerationRequest
  ): Promise<TitleGenerationResult> {
    try {
      console.log('[TitleGeneration] タイトル生成開始:', request.rss_title);

      // YAMLテンプレートを読み込み
      const template = await this.templateLoader.loadTemplate(this.templateId);

      // プロンプトを構築（YAMLテンプレート全体を含む）
      const prompt = this.buildPrompt(template, request);

      // デバッグ: 送信プロンプトをログ出力
      if (process.env.DEBUG_TITLE_PROMPT === 'true') {
        console.log('\n[TitleGeneration] ========== 送信プロンプト全文 ==========');
        console.log(prompt);
        console.log('[TitleGeneration] ========== プロンプト終了 ==========\n');
      }

      // AI Provider経由でAPI呼び出し（マルチプロバイダー対応）
      const response = await this.aiProvider.sendMessage(prompt, {
        maxTokens: 500, // タイトルは短いので500で十分
        temperature: 0.7, // 創造性と正確性のバランス
        responseFormat: 'text',
      });

      // レスポンスからタイトルを抽出
      const title = this.extractTitle(response.content);

      // タイトルの文字数を検証
      const length = this.countCharacters(title);
      const is_valid = length >= 28 && length <= 40;

      console.log('[TitleGeneration] タイトル生成完了:', {
        title,
        length,
        is_valid,
        recommended: length >= 32 && length <= 36,
      });

      if (!is_valid) {
        console.warn(
          `[TitleGeneration] タイトルが文字数制約（28〜40文字）を満たしていません: ${length}文字`
        );
      }

      return {
        title,
        length,
        is_valid,
      };
    } catch (error) {
      console.error('[TitleGeneration] タイトル生成エラー:', error);
      throw new Error(
        `タイトル生成失敗: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * プロンプトを構築
   * @param template YAMLテンプレート全体
   * @param request リクエストデータ
   * @returns 完成したプロンプト
   */
  private buildPrompt(
    template: any,
    request: TitleGenerationRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);

    // 最終プロンプトを構築
    return `${template.prompts.generate_title}

${rulesSection}

---

## 入力データ（RSS記事）

- タイトル: ${request.rss_title}
- URL: ${request.rss_link}
- 本文: ${request.rss_content.substring(0, 3000)}${request.rss_content.length > 3000 ? '...' : ''}

---

上記のRSS記事情報から、必要な情報（作品名、店舗名、開催日、略称、複数店舗情報など）を抽出し、
仕様に従って最適な記事タイトルを生成してください。

重要: タイトル文のみを出力し、説明文・理由・JSON・補足テキストなどは一切含めないでください。`;
  }

  /**
   * YAMLテンプレートからルール定義セクションを構築
   * @param template YAMLテンプレート
   * @returns ルール定義のテキスト
   */
  private buildRulesSection(template: any): string {
    const sections: string[] = [];

    // 文字数制約
    if (template.constraints?.title_length) {
      const tl = template.constraints.title_length;
      sections.push(`## 文字数制約（必須）
- 最小: ${tl.min}文字
- 最大: ${tl.max}文字
- 推奨: ${tl.recommended}
- カウント方法: ${tl.count_rule}`);
    }

    // スペースルール
    if (template.constraints?.spacing) {
      sections.push(`## スペースルール
- ${template.constraints.spacing.rule}`);
    }

    // 作品名の略称ロジック
    if (template.logic?.work_name_normalization) {
      sections.push(`## 作品名の決定ロジック（略称の使用判断）
${template.logic.work_name_normalization}`);
    }

    // 複数店舗のロケーション抽出ロジック
    if (template.logic?.multi_location_extraction) {
      sections.push(`## 複数店舗時のロケーション抽出ルール
${template.logic.multi_location_extraction}`);
    }

    // 施設名の分類ロジック
    if (template.logic?.facility_name_classification) {
      sections.push(`## 施設名カテゴリの判定基準
${template.logic.facility_name_classification}`);
    }

    // ルール適用順序
    if (template.logic?.rule_application_order) {
      sections.push(`## ルール適用順序
${template.logic.rule_application_order}`);
    }

    // タイトル命名ルール
    if (template.rules && Array.isArray(template.rules)) {
      const rulesText = template.rules.map((rule: any) => {
        let ruleStr = `### ${rule.id}: ${rule.name}
- 条件: ${rule.condition}`;

        if (rule.template) {
          ruleStr += `\n- テンプレート: ${rule.template}`;
        }
        if (rule.template_primary) {
          ruleStr += `\n- プライマリテンプレート: ${rule.template_primary}`;
        }
        if (rule.template_fallback) {
          ruleStr += `\n- フォールバックテンプレート: ${rule.template_fallback}`;
        }
        if (rule.example?.template_filled) {
          ruleStr += `\n- 例: ${rule.example.template_filled}`;
        }
        if (rule.template_primary_example?.template_filled) {
          ruleStr += `\n- プライマリ例: ${rule.template_primary_example.template_filled}`;
        }

        return ruleStr;
      }).join('\n\n');

      sections.push(`## タイトル命名ルール（条件分岐）
${rulesText}`);
    }

    return sections.join('\n\n');
  }

  /**
   * AI APIのレスポンスからタイトルを抽出
   * @param response レスポンステキスト
   * @returns タイトル文字列
   */
  private extractTitle(response: string): string {
    // レスポンスをトリムし、前後の空白や改行を削除
    let title = response.trim();

    // マークダウンコードブロックが含まれている場合は除去
    const codeBlockMatch = title.match(/```(?:text)?\n(.*?)\n```/s);
    if (codeBlockMatch) {
      title = codeBlockMatch[1].trim();
    }

    // 複数行ある場合は最初の行のみを採用
    const lines = title.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) {
      title = lines[0].trim();
    }

    // 前後の引用符を削除
    title = title.replace(/^["']|["']$/g, '');

    return title;
  }

  /**
   * タイトルの文字数をカウント
   * 全角・半角・記号・スペースをすべて1文字としてカウント
   * @param title タイトル文字列
   * @returns 文字数
   */
  private countCharacters(title: string): number {
    return title.length;
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 *
 * @description
 * モジュールロード時ではなく、初回アクセス時にインスタンスを生成します。
 * これにより、環境変数（.env.local）が読み込まれた後にAIプロバイダーが
 * 初期化されることを保証します。
 */
let _titleGenerationService: TitleGenerationService | null = null;

export function getTitleGenerationService(): TitleGenerationService {
  if (!_titleGenerationService) {
    _titleGenerationService = new TitleGenerationService();
  }
  return _titleGenerationService;
}

/**
 * @deprecated Use getTitleGenerationService() instead
 * シングルトンインスタンスへの直接アクセスは非推奨です。
 * 遅延初期化のため、getTitleGenerationService() を使用してください。
 */
export const titleGenerationService = {
  get instance() {
    return getTitleGenerationService();
  },
  generateTitle: (request: TitleGenerationRequest) =>
    getTitleGenerationService().generateTitle(request),
};
