/**
 * Content Generation Service
 * 抽出済み情報から記事本文（MDX）を生成するサービス
 *
 * @description
 * モジュール化テンプレート（4-content.yaml + sections/*.yaml）を使用して、
 * AIに記事本文を生成させます。
 *
 * 方針A（AI-based）を採用:
 * - YAMLテンプレートのルール定義をAIプロンプトに含める
 * - セクションスキップの判断はAIに委ねる
 * - 作品タイプに応じた柔軟な文章生成が可能
 */

import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { MergedModularTemplate, SectionTemplate } from '@/lib/types/modular-template';
import type { ExtractionResult } from './extraction.service';

/**
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * コンテンツ生成リクエスト
 */
export interface ContentGenerationRequest {
  /** 2-extraction の出力 */
  extractedData: ExtractionResult;
  /** 3-title の出力 */
  generatedTitle: string;
  /** 公式サイトのHTMLコンテンツ（参考情報） */
  officialHtml?: string;
}

/**
 * コンテンツ生成結果
 */
export interface ContentGenerationResult {
  /** 生成されたMDX本文 */
  content: string;
  /** 生成されたセクション一覧 */
  generatedSections: string[];
  /** スキップされたセクション一覧 */
  skippedSections: string[];
  /** Model used for generation */
  model?: string;
  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}

/**
 * コンテンツ生成サービス
 */
export class ContentGenerationService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  /** モジュール化テンプレートID */
  private readonly templateId = 'collabo-cafe';
  /** パイプラインID */
  private readonly pipelineId = '4-content';

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * 記事本文（MDX）を生成
   * @param request コンテンツ生成リクエスト
   * @returns 生成されたMDX本文
   */
  async generateContent(request: ContentGenerationRequest): Promise<ContentGenerationResult> {
    try {
      console.log('[ContentGeneration] 本文生成開始');

      // モジュール化YAMLテンプレートを読み込み（セクション含む）
      const template = await this.templateLoader.loadModularTemplate(
        this.templateId,
        this.pipelineId,
        { includeSections: true }
      );

      // プロンプトを構築（YAMLテンプレート全体を含む）
      const prompt = this.buildPrompt(template, request);

      // デバッグ: 送信プロンプトをログ出力
      if (process.env.DEBUG_CONTENT_PROMPT === 'true') {
        console.log('\n[ContentGeneration] ========== 送信プロンプト全文 ==========');
        console.log(prompt);
        console.log('[ContentGeneration] ========== プロンプト終了 ==========\n');
      }

      // AI Provider経由でAPI呼び出し
      const response = await this.aiProvider.sendMessage(prompt, {
        maxTokens: 8000, // MDX本文生成のため大きめに
        temperature: 0.7, // 創造性を許容
        responseFormat: 'json',
      });

      // AI APIのレスポンスをログ出力
      console.log('\n[ContentGeneration] === AI APIレスポンス ===');
      console.log(`[ContentGeneration] model: ${response.model}`);
      console.log('[ContentGeneration] === レスポンス終了 ===\n');

      // レスポンスをパース
      const result = this.parseResponse(response.content, template);

      console.log('[ContentGeneration] 本文生成完了:', {
        contentLength: result.content.length,
        generatedSections: result.generatedSections,
        skippedSections: result.skippedSections,
      });

      // model/usage をコスト追跡用に追加
      return {
        ...result,
        model: response.model,
        usage: response.usage,
      };
    } catch (error) {
      console.error('[ContentGeneration] 本文生成エラー:', error);
      throw new Error(
        `本文生成失敗: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    request: ContentGenerationRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);
    const sectionsSection = this.buildSectionsSection(template);

    // 最終プロンプトを構築
    return `${template.prompts.generate_content}

${rulesSection}

${sectionsSection}

---

## 入力データ

### extracted_data (2-extraction の出力)
\`\`\`json
${JSON.stringify(request.extractedData, null, 2)}
\`\`\`

### generated_title (3-title の出力)
${request.generatedTitle}

${request.officialHtml ? `### 参考: 公式サイトの内容（一部）
${request.officialHtml.substring(0, 5000)}${request.officialHtml.length > 5000 ? '\n...(truncated)' : ''}` : ''}

---

上記の入力データとルールに従い、JSON形式でのみ出力してください。

出力形式:
\`\`\`json
{
  "content": "生成されたMDX本文（全セクションを結合）",
  "generatedSections": ["lead", "menu", "novelty", "goods", "summary"],
  "skippedSections": ["スキップしたセクションID"]
}
\`\`\`

重要:
- JSON以外のテキストは一切出力しないこと
- 各セクション間は空行で区切る
- h1 は使用しない（タイトルで使用されるため）
- セクションのスキップ判断は skip_if 条件に従う
- メディアタイプ/原作タイプ/原作者有無に応じたテンプレート選択は work_type_template_selection ロジックに従う
- 原作者有無 === true の場合のみ「○○先生」または「○○さん」形式で原作者名を使用
- 開催期間は { 開始: { 年, 日付 }, 終了: { 年, 日付, 未定 } } 構造で渡される（年またぎ対応）`;
  }

  /**
   * ルールセクションを構築
   */
  private buildRulesSection(template: MergedModularTemplate): string {
    const sections: string[] = [];

    // パイプラインのlogicセクション
    if (template.logic) {
      sections.push('## コンテンツ生成ロジック');

      if (template.logic.work_type_template_selection) {
        sections.push(`### 作品タイプ別テンプレート選択\n\n${template.logic.work_type_template_selection}`);
      }

      if (template.logic.section_skip_conditions) {
        sections.push(`### セクションスキップ条件\n\n${template.logic.section_skip_conditions}`);
      }

      if (template.logic.date_format_handling) {
        sections.push(`### 日付フォーマット\n\n${template.logic.date_format_handling}`);
      }
    }

    // 出力構造
    if (template.output?.structure) {
      sections.push(`## 出力セクション構造\n\n${template.output.structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * セクション定義をプロンプト用に構築
   */
  private buildSectionsSection(template: MergedModularTemplate): string {
    if (!template._sections?.templates) {
      return '';
    }

    const sections: string[] = ['## セクション定義'];

    for (const [sectionId, sectionTemplate] of Object.entries(template._sections.templates)) {
      const section = sectionTemplate as SectionTemplate;
      const sectionInfo: string[] = [];

      sectionInfo.push(`### ${sectionId}: ${section.section?.name || sectionId}`);

      // スキップ条件
      if (section.skip_if) {
        sectionInfo.push(`**スキップ条件**: \`${section.skip_if}\``);
      }

      // 必須プレースホルダー
      if (section.required_placeholders) {
        sectionInfo.push(`**必須項目**: ${section.required_placeholders.join(', ')}`);
      }

      // オプションプレースホルダー
      if (section.optional_placeholders) {
        sectionInfo.push(`**オプション項目**: ${section.optional_placeholders.join(', ')}`);
      }

      // 条件分岐
      if (section.conditions) {
        sectionInfo.push('\n**条件分岐**:');
        for (const cond of section.conditions) {
          sectionInfo.push(`- \`${cond.id}\`: ${cond.condition} → テンプレート \`${cond.template}\``);
        }
      }

      // テンプレート例
      if (section.templates) {
        sectionInfo.push('\n**テンプレート例**:');
        for (const [tmplId, tmplContent] of Object.entries(section.templates)) {
          // 最初の200文字だけ表示（プロンプトが長くなりすぎないように）
          const preview = String(tmplContent).substring(0, 300);
          sectionInfo.push(`\n\`${tmplId}\`:\n\`\`\`\n${preview}${String(tmplContent).length > 300 ? '\n...(truncated)' : ''}\n\`\`\``);
        }
      }

      sections.push(sectionInfo.join('\n'));
    }

    return sections.join('\n\n');
  }

  /**
   * AI APIからのレスポンスをパース
   */
  private parseResponse(
    response: string,
    template: MergedModularTemplate
  ): ContentGenerationResult {
    try {
      let jsonData: {
        content: string;
        generatedSections?: string[];
        skippedSections?: string[];
      };

      // JSONを抽出してパース
      try {
        jsonData = JSON.parse(response.trim());
      } catch (directParseError) {
        // マークダウンコードブロックから抽出を試みる
        const jsonMatch =
          response.match(/```json\n([\s\S]*?)\n```/) ||
          response.match(/```\n([\s\S]*?)\n```/) ||
          response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('[ContentGeneration] JSON not found in response:', response);
          throw new Error('No JSON found in response');
        }

        jsonData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      // 必須フィールドの検証
      if (!jsonData.content) {
        throw new Error('Missing required field: content');
      }

      // パース済みデータをログ出力
      console.log('\n[ContentGeneration] === パース済みデータ ===');
      console.log('content length:', jsonData.content.length);
      console.log('generatedSections:', jsonData.generatedSections || []);
      console.log('skippedSections:', jsonData.skippedSections || []);
      console.log('[ContentGeneration] === 詳細終了 ===\n');

      // デフォルト値を設定
      const allSections = template._sections?.order || ['lead', 'menu', 'novelty', 'goods', 'summary'];
      const generatedSections = jsonData.generatedSections || allSections;
      const skippedSections = jsonData.skippedSections || [];

      return {
        content: jsonData.content,
        generatedSections,
        skippedSections,
      };
    } catch (error) {
      console.error('[ContentGeneration] Failed to parse response:', error);
      throw new Error(
        `Failed to parse content generation response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _contentGenerationService: ContentGenerationService | null = null;

export function getContentGenerationService(): ContentGenerationService {
  if (!_contentGenerationService) {
    _contentGenerationService = new ContentGenerationService();
  }
  return _contentGenerationService;
}

/**
 * @deprecated Use getContentGenerationService() instead
 */
export const contentGenerationService = {
  get instance() {
    return getContentGenerationService();
  },
  generateContent: (request: ContentGenerationRequest) =>
    getContentGenerationService().generateContent(request),
};
