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
import type { MergedModularTemplate } from '@/lib/types/modular-template';

/**
 * タイトル生成サービス
 */
export class TitleGenerationService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  /** モジュール化テンプレートID */
  private readonly templateId = 'collabo-cafe';
  /** パイプラインID */
  private readonly pipelineId = '3-title';

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

      // モジュール化YAMLテンプレートを読み込み
      const template = await this.templateLoader.loadModularTemplate(
        this.templateId,
        this.pipelineId,
        { includeSections: false } // タイトル生成ではセクション不要
      );

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
        maxTokens: 800, // JSON形式 + reasoning のため増加
        temperature: 0.7, // 創造性と正確性のバランス
        responseFormat: 'json',
      });

      // レスポンスからタイトルとreasoningを抽出
      const { title, _reasoning } = this.parseResponse(response.content);

      // タイトルの文字数を検証
      const length = this.countCharacters(title);
      const is_valid = length >= 28 && length <= 40;

      console.log('[TitleGeneration] タイトル生成完了:', {
        title,
        length,
        is_valid,
        recommended: length >= 32 && length <= 36,
      });

      // デバッグモード時は reasoning を表示
      if (process.env.DEBUG_TITLE_PROMPT === 'true' && _reasoning) {
        console.log('\n[TitleGeneration] === タイトル生成理由 ===');
        console.log(_reasoning);
        console.log('[TitleGeneration] === 理由終了 ===\n');
      }

      if (!is_valid) {
        console.warn(
          `[TitleGeneration] タイトルが文字数制約（28〜40文字）を満たしていません: ${length}文字`
        );
      }

      return {
        title,
        length,
        is_valid,
        _reasoning,
        model: response.model,
        usage: response.usage,
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
   * @param template モジュール化YAMLテンプレート
   * @param request リクエストデータ
   * @returns 完成したプロンプト
   */
  private buildPrompt(
    template: MergedModularTemplate,
    request: TitleGenerationRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);

    // 抽出済みデータセクション（Step 1.5 で抽出済みの情報がある場合）
    const extractedDataSection = this.buildExtractedDataSection(request);

    // 最終プロンプトを構築
    return `${template.prompts.generate_title}

${rulesSection}

---

## 入力データ（RSS記事）

- タイトル: ${request.rss_title}
- URL: ${request.rss_link}
- 本文: ${request.rss_content.substring(0, 3000)}${request.rss_content.length > 3000 ? '...' : ''}
${extractedDataSection}
---

上記のRSS記事情報から、必要な情報（作品名、店舗名、開催日、略称、複数店舗情報など）を抽出し、
仕様に従って最適な記事タイトルを生成してください。

【出力形式】
以下のJSON形式で出力してください:
\`\`\`json
{
  "title": "生成したタイトル（28〜40文字）",
  "_reasoning": "タイトル生成の判断理由（適用したルール、日付の選択理由など）"
}
\`\`\``;
  }

  /**
   * 抽出済みデータセクションを構築
   * Step 1.5 で抽出済みの情報がある場合、AIに優先的に使用させる
   */
  private buildExtractedDataSection(request: TitleGenerationRequest): string {
    const parts: string[] = [];

    if (request.extractedPeriod || request.extractedStoreName || request.extractedWorkName) {
      parts.push('\n## 抽出済みデータ（以下の情報は検証済みのため、優先的に使用してください）');

      if (request.extractedWorkName) {
        parts.push(`- 作品名（確定）: ${request.extractedWorkName}`);
      }

      if (request.extractedStoreName) {
        parts.push(`- 店舗名（確定）: ${request.extractedStoreName}`);
      }

      if (request.extractedPeriod) {
        const period = request.extractedPeriod;
        const startDate = `${period.開始.年}${period.開始.日付}`;
        parts.push(`- 開催開始日（確定）: ${startDate}`);

        if (!period.終了.未定 && period.終了.日付) {
          const endDate = `${period.終了.年 || ''}${period.終了.日付}`;
          parts.push(`- 開催終了日（確定）: ${endDate}`);
        } else {
          parts.push(`- 開催終了日: 未定`);
        }

        // タイトルには開始日（月日形式）を使用するよう明示
        // 例: "12月18日" → タイトルに「12月18日よりコラボ開催」と記載
        const startDateForTitle = period.開始.日付; // "12月18日" 形式
        if (startDateForTitle) {
          parts.push(`- ⚠️ 重要: タイトルの開始日は「${startDateForTitle}」を使用してください。月のみ（例: 12月）ではなく、日付まで含めてください。`);
        }
      }

      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * モジュール化YAMLテンプレートからルール定義セクションを構築
   * @param template モジュール化YAMLテンプレート
   * @returns ルール定義のテキスト
   */
  private buildRulesSection(template: MergedModularTemplate): string {
    const sections: string[] = [];

    // 文字数制約（モジュール化テンプレート: constraints.title.length）
    const titleConstraints = (template.constraints as any)?.title;
    if (titleConstraints?.length) {
      const tl = titleConstraints.length;
      sections.push(`## 文字数制約（必須）
- 最小: ${tl.min}文字
- 最大: ${tl.max}文字
- 推奨: ${tl.recommended}
- カウント方法: ${titleConstraints.count_rule || '全角・半角・記号・スペースをすべて1文字としてカウント'}`);
    }

    // スペースルール（モジュール化テンプレート: constraints.title.spacing）
    if (titleConstraints?.spacing) {
      sections.push(`## スペースルール
- ${titleConstraints.spacing.rule}`);
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

        // ルール固有のロジック（location_extraction など）
        if (rule.logic) {
          for (const [logicKey, logicValue] of Object.entries(rule.logic)) {
            ruleStr += `\n- ${logicKey}: ${logicValue}`;
          }
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
   * AI APIのレスポンスをパース（JSON形式）
   * @param response レスポンステキスト
   * @returns タイトルとreasoning
   */
  private parseResponse(response: string): { title: string; _reasoning?: string } {
    let content = response.trim();

    // マークダウンコードブロックが含まれている場合は除去
    const codeBlockMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    }

    try {
      // JSON形式でパース
      const parsed = JSON.parse(content);

      if (parsed.title) {
        return {
          title: parsed.title.trim(),
          _reasoning: parsed._reasoning || undefined,
        };
      }
    } catch (e) {
      // JSONパースに失敗した場合はフォールバック
      console.warn('[TitleGeneration] JSONパース失敗、テキストモードにフォールバック');
    }

    // フォールバック: 最初の行をタイトルとして扱う
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    let title = lines[0] || content;

    // 前後の引用符を削除
    title = title.replace(/^["']|["']$/g, '');

    return { title: title.trim() };
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
