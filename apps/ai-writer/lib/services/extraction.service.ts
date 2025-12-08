/**
 * Extraction Service
 * 公式サイトHTMLから記事生成に必要な情報を抽出するサービス
 *
 * @description
 * モジュール化テンプレート（2-extraction.yaml）を使用して、
 * 公式サイトから作品名、店舗名、開催期間などの詳細情報を抽出します。
 *
 * 注意: このサービスは extractFromRss() とは異なる目的です。
 * - extractFromRss(): RSS記事テキストから基本情報を抽出
 * - ExtractionService: 公式サイトHTMLから詳細情報を抽出
 */

import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { MergedModularTemplate } from '@/lib/types/modular-template';

/**
 * 抽出リクエスト
 */
export interface ExtractionRequest {
  /** 公式サイトURL */
  primary_official_url: string;
  /** 公式サイトのHTMLコンテンツまたはテキスト */
  page_content: string;
  /** 補助的なURL群（オプション） */
  official_urls?: string[];
}

/**
 * 開催期間
 */
export interface EventPeriod {
  /** 年（YYYY年形式） */
  年: string;
  /** 開始日（N月NN日形式） */
  開始日: string;
  /** 終了日（N月NN日形式、未定の場合はnull） */
  終了日: string | null;
}

/**
 * 抽出結果
 */
export interface ExtractionResult {
  /** 作品名 */
  作品名: string;
  /** 作品タイプ */
  作品タイプ: 'anime' | 'manga' | 'game' | 'youtuber' | 'idol' | 'movie_drama' | 'other';
  /** 原作者名（「○○先生」形式、不要な場合はnull） */
  原作者名: string | null;
  /** 店舗名（複数の場合は「、」区切り） */
  店舗名: string;
  /** 開催期間 */
  開催期間: EventPeriod;
  /** 公式サイトURL */
  公式サイトURL: string;
  /** 略称（広く認知されているもののみ、なければnull） */
  略称: string | null;
  /** 複数店舗情報（生テキスト、なければnull） */
  複数店舗情報: string | null;
  /** キャラクター名リスト（明示的に記載されているもののみ） */
  キャラクター名: string[] | null;
  /** 描き下ろしイラストのテーマ名 */
  テーマ名: string | null;
  /** 特典ノベルティの名称 */
  ノベルティ名: string | null;
  /** ノベルティ種類数（「全N種」形式） */
  ノベルティ種類数: string | null;
  /** メニュー種類数（「計NN種」形式） */
  メニュー種類数: string | null;
  /** コラボグッズ名リスト */
  グッズ名: string[] | null;
  /** 店舗の住所（1店舗の場合のみ） */
  店舗の住所: string | null;
  /** コピーライト表記 */
  コピーライト: string | null;
  /** 公式X（Twitter）の投稿URL */
  TwitterURL: string | null;
}

/**
 * 抽出サービス
 */
export class ExtractionService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  /** モジュール化テンプレートID */
  private readonly templateId = 'collabo-cafe';
  /** パイプラインID */
  private readonly pipelineId = '2-extraction';

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * 公式サイトから記事生成に必要な情報を抽出
   * @param request 抽出リクエスト
   * @returns 抽出結果
   */
  async extractFromOfficialSite(request: ExtractionRequest): Promise<ExtractionResult> {
    try {
      console.log('[Extraction] 情報抽出開始:', request.primary_official_url);

      // モジュール化YAMLテンプレートを読み込み
      const template = await this.templateLoader.loadModularTemplate(
        this.templateId,
        this.pipelineId,
        { includeSections: false } // 情報抽出ではセクション不要
      );

      // プロンプトを構築（YAMLテンプレート全体を含む）
      const prompt = this.buildPrompt(template, request);

      // デバッグ: 送信プロンプトをログ出力
      if (process.env.DEBUG_EXTRACTION_PROMPT === 'true') {
        console.log('\n[Extraction] ========== 送信プロンプト全文 ==========');
        console.log(prompt);
        console.log('[Extraction] ========== プロンプト終了 ==========\n');
      }

      // AI Provider経由でAPI呼び出し
      const response = await this.aiProvider.sendMessage(prompt, {
        maxTokens: 4000, // HTML全文対応のため増加
        temperature: 0.2, // 抽出は正確性を重視
        responseFormat: 'json',
      });

      // AI APIのレスポンスをログ出力
      console.log('\n[Extraction] === AI APIレスポンス ===');
      console.log(`[Extraction] model: ${response.model}`);
      console.log('[Extraction] === レスポンス終了 ===\n');

      // レスポンスをパース
      const result = this.parseResponse(response.content, request.primary_official_url);

      console.log('[Extraction] 抽出完了:', {
        作品名: result.作品名,
        店舗名: result.店舗名,
        開催期間: result.開催期間,
      });

      return result;
    } catch (error) {
      console.error('[Extraction] 情報抽出エラー:', error);
      throw new Error(
        `情報抽出失敗: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    request: ExtractionRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);

    // 最終プロンプトを構築
    return `${template.prompts.extraction}

${rulesSection}

---

## 入力データ

- primary_official_url: ${request.primary_official_url}
- ページコンテンツ:

${request.page_content.substring(0, 15000)}${request.page_content.length > 15000 ? '\n...(truncated)' : ''}

---

上記のページコンテンツを解析し、JSON形式でのみ出力してください。`;
  }

  /**
   * モジュール化YAMLテンプレートからルール定義セクションを構築
   * @param template モジュール化YAMLテンプレート
   * @returns ルール定義のテキスト
   */
  private buildRulesSection(template: MergedModularTemplate): string {
    const sections: string[] = [];

    // 抽出対象フィールド定義
    const extractionFields = (template as any).extraction_fields;
    if (extractionFields) {
      let fieldsText = '## 抽出対象フィールド\n\n### 必須フィールド\n';
      if (extractionFields.required) {
        for (const field of extractionFields.required) {
          fieldsText += `- **${field.name}** (${field.type}): ${field.extraction_hint || ''}\n`;
        }
      }
      fieldsText += '\n### オプションフィールド\n';
      if (extractionFields.optional) {
        for (const field of extractionFields.optional) {
          fieldsText += `- **${field.name}** (${field.type}): ${field.extraction_hint || ''}\n`;
        }
      }
      sections.push(fieldsText);
    }

    // 作品タイプ判定ロジック
    if (template.logic?.work_type_detection) {
      sections.push(`## 作品タイプ判定ロジック

${template.logic.work_type_detection}`);
    }

    // 原作者抽出ロジック
    if (template.logic?.author_extraction) {
      sections.push(`## 原作者名抽出ルール

${template.logic.author_extraction}`);
    }

    // 日付正規化ロジック
    if (template.logic?.date_normalization) {
      sections.push(`## 日付の正規化ルール

${template.logic.date_normalization}`);
    }

    // 店舗名正規化ロジック
    if (template.logic?.store_name_normalization) {
      sections.push(`## 店舗名の正規化ルール

${template.logic.store_name_normalization}`);
    }

    // 出力形式の定義
    if (template.output?.schema) {
      const schemaStr = typeof template.output.schema === 'string'
        ? template.output.schema
        : JSON.stringify(template.output.schema, null, 2);
      sections.push(`## 出力形式（JSON Schema）

\`\`\`json
${schemaStr}
\`\`\``);
    }

    return sections.join('\n\n');
  }

  /**
   * AI APIからのレスポンスをパース
   * @param response レスポンステキスト
   * @param officialUrl 公式サイトURL
   * @returns パース済みの抽出結果
   */
  private parseResponse(response: string, officialUrl: string): ExtractionResult {
    try {
      let jsonData: any;

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
          console.error('[Extraction] JSON not found in response:', response);
          throw new Error('No JSON found in response');
        }

        jsonData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      // 必須フィールドの検証
      if (!jsonData.作品名) {
        throw new Error('Missing required field: 作品名');
      }
      if (!jsonData.店舗名) {
        throw new Error('Missing required field: 店舗名');
      }
      if (!jsonData.開催期間) {
        throw new Error('Missing required field: 開催期間');
      }

      // パース済みデータをログ出力
      console.log('\n[Extraction] === パース済みデータ ===');
      console.log('作品名:', jsonData.作品名);
      console.log('作品タイプ:', jsonData.作品タイプ);
      console.log('店舗名:', jsonData.店舗名);
      console.log('開催期間:', JSON.stringify(jsonData.開催期間));
      console.log('[Extraction] === 詳細終了 ===\n');

      return {
        作品名: jsonData.作品名,
        作品タイプ: jsonData.作品タイプ || 'anime',
        原作者名: jsonData.原作者名 || null,
        店舗名: jsonData.店舗名,
        開催期間: {
          年: jsonData.開催期間?.年 || new Date().getFullYear().toString() + '年',
          開始日: jsonData.開催期間?.開始日 || '',
          終了日: jsonData.開催期間?.終了日 || null,
        },
        公式サイトURL: officialUrl,
        略称: jsonData.略称 || null,
        複数店舗情報: jsonData.複数店舗情報 || null,
        キャラクター名: jsonData.キャラクター名 || null,
        テーマ名: jsonData.テーマ名 || null,
        ノベルティ名: jsonData.ノベルティ名 || null,
        ノベルティ種類数: jsonData.ノベルティ種類数 || null,
        メニュー種類数: jsonData.メニュー種類数 || null,
        グッズ名: jsonData.グッズ名 || null,
        店舗の住所: jsonData.店舗の住所 || null,
        コピーライト: jsonData.コピーライト || null,
        TwitterURL: jsonData.TwitterURL || null,
      };
    } catch (error) {
      console.error('[Extraction] Failed to parse response:', error);
      throw new Error(
        `Failed to parse extraction response: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
let _extractionService: ExtractionService | null = null;

export function getExtractionService(): ExtractionService {
  if (!_extractionService) {
    _extractionService = new ExtractionService();
  }
  return _extractionService;
}

/**
 * @deprecated Use getExtractionService() instead
 * シングルトンインスタンスへの直接アクセスは非推奨です。
 * 遅延初期化のため、getExtractionService() を使用してください。
 */
export const extractionService = {
  get instance() {
    return getExtractionService();
  },
  extractFromOfficialSite: (request: ExtractionRequest) =>
    getExtractionService().extractFromOfficialSite(request),
};
