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
 * 開催期間（年またぎ対応版 v2.0.0）
 *
 * @description
 * 開始・終了それぞれに年を持つことで、年またぎイベントに正確に対応。
 * 例: 2025年12月19日 〜 2026年4月19日
 */
export interface EventPeriod {
  /** 開始日情報 */
  開始: {
    /** 年（YYYY年形式） */
    年: string;
    /** 日付（N月NN日形式） */
    日付: string;
  };
  /** 終了日情報 */
  終了: {
    /** 年（YYYY年形式、未定の場合はnull） */
    年: string | null;
    /** 日付（N月NN日形式、未定の場合はnull） */
    日付: string | null;
    /** 終了日が未定の場合はtrue */
    未定: boolean;
  };
}

/**
 * メディアタイプ
 * 作品がどのメディア形態で展開されているかを識別
 */
export type MediaType =
  | 'anime'        // TVアニメ作品
  | 'anime_movie'  // 劇場版アニメ（漫画原作含む）
  | 'manga'        // 漫画作品（アニメ化されていない）
  | 'game'         // ゲーム作品
  | 'vtuber'       // VTuber
  | 'youtuber'     // YouTuber・ゲーム実況者・ストリーマー
  | 'idol'         // アイドル・芸能人・音楽アーティスト
  | 'voice_actor'  // 声優
  | 'vocaloid'     // ボーカロイド/音声合成キャラクター
  | 'character'    // キャラクターブランド（サンリオ、すみっコぐらし等）
  | 'movie'        // 映画（実写・CGアニメ含む）
  | 'drama'        // ドラマ作品
  | 'tokusatsu'    // 特撮作品（仮面ライダー、ウルトラマン等）
  | 'other';       // その他

/**
 * 原作タイプ
 * 原作者（個人クリエイター）が存在するかを判断するための分類
 */
export type SourceType =
  // 原作者が存在する（敬称は「先生」）
  | 'manga_based'            // 漫画原作
  | 'novel_based'            // 小説・ライトノベル原作
  | 'original_with_creator'  // 個人クリエイターのオリジナル映像
  | 'game_creator_based'     // ゲームクリエイター個人
  | 'illustrator_based'      // イラストレーター個人
  // クリエイター名を使う（敬称は「さん」）
  | 'music_creator_based'    // 作曲家/ボカロP個人（米津玄師さん等）
  // 原作者が存在しない
  | 'original_anime'         // オリジナルアニメ
  | 'studio_production'      // スタジオ・企業制作
  | 'game_original'          // ゲーム会社制作
  | 'character_brand'        // キャラクターブランド
  | 'vocaloid_character'     // ボーカロイドキャラクター
  | 'youtuber'               // YouTuber・VTuber・ストリーマー本人
  | 'idol'                   // アイドル・芸能人・音楽アーティスト本人
  | 'voice_actor'            // 声優本人
  | 'tokusatsu'              // 特撮作品
  | 'other';                 // その他

/**
 * Token usage statistics from AI provider
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 抽出結果
 */
export interface ExtractionResult {
  /** 作品名 */
  作品名: string;
  /** メディアタイプ（作品がどのメディア形態で展開されているか） */
  メディアタイプ: MediaType;
  /** 原作タイプ（原作者の有無を判断するための分類） */
  原作タイプ: SourceType;
  /** 原作者有無（個人クリエイターが存在するか） */
  原作者有無: boolean;
  /** 原作者名（「○○先生」または「○○さん」形式、不要な場合はnull） */
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
  /**
   * 開催都道府県（日本語正式名称の配列）
   * @description 店舗名・住所から特定された都道府県
   * @see taxonomy.yaml axes.areas
   * @example ["東京都", "大阪府"]
   */
  開催都道府県: string[] | null;
  /** コピーライト表記 */
  コピーライト: string | null;
  /** 公式X（Twitter）の投稿URL */
  TwitterURL: string | null;
  /**
   * AIの判断理由（デバッグ用）
   * 主要な判断箇所についてAIがどのような根拠で結論に至ったかを記録
   */
  _reasoning?: {
    /** 開催期間の判断理由（年またぎ判定ロジック含む） */
    開催期間?: string;
    /** メディアタイプの判断理由 */
    メディアタイプ?: string;
    /** 原作タイプの判断理由 */
    原作タイプ?: string;
    /** 原作者名の判断理由（敬称選択ロジック含む） */
    原作者名?: string;
    /** 開催都道府県の特定根拠（店舗名/住所/明示的記載から） */
    開催都道府県?: string;
  };
  /** Model used for extraction */
  model?: string;
  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
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
      const result = this.parseResponse(
        response.content,
        request.primary_official_url,
        response.model,
        response.usage
      );

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

    // メディアタイプ判定ロジック（v2.0.0: media_type_detection）
    if (template.logic?.media_type_detection) {
      sections.push(`## メディアタイプ判定ロジック

${template.logic.media_type_detection}`);
    }

    // 原作タイプ判定ロジック（v2.0.0: source_type_detection）
    if (template.logic?.source_type_detection) {
      sections.push(`## 原作タイプ判定ロジック

${template.logic.source_type_detection}`);
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
   * @param model 使用したモデル名
   * @param usage トークン使用量
   * @returns パース済みの抽出結果
   */
  private parseResponse(
    response: string,
    officialUrl: string,
    model?: string,
    usage?: TokenUsage
  ): ExtractionResult {
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

      // 開催期間の新構造を構築（年またぎ対応 v2.0.0）
      const currentYear = new Date().getFullYear().toString() + '年';
      const eventPeriod: EventPeriod = {
        開始: {
          年: jsonData.開催期間?.開始?.年 || currentYear,
          日付: jsonData.開催期間?.開始?.日付 || '',
        },
        終了: {
          年: jsonData.開催期間?.終了?.年 ?? null,
          日付: jsonData.開催期間?.終了?.日付 ?? null,
          未定: jsonData.開催期間?.終了?.未定 ?? false,
        },
      };

      // パース済みデータをログ出力
      console.log('\n[Extraction] === パース済みデータ ===');
      console.log('作品名:', jsonData.作品名);
      console.log('メディアタイプ:', jsonData.メディアタイプ);
      console.log('原作タイプ:', jsonData.原作タイプ);
      console.log('原作者有無:', jsonData.原作者有無);
      console.log('原作者名:', jsonData.原作者名);
      console.log('店舗名:', jsonData.店舗名);
      console.log('開催期間:', JSON.stringify(eventPeriod, null, 2));

      // _reasoning があればログ出力（デバッグ用）
      if (jsonData._reasoning) {
        console.log('\n[Extraction] === AI判断理由 (_reasoning) ===');
        if (jsonData._reasoning.開催期間) {
          console.log('📅 開催期間:', jsonData._reasoning.開催期間);
        }
        if (jsonData._reasoning.メディアタイプ) {
          console.log('🎬 メディアタイプ:', jsonData._reasoning.メディアタイプ);
        }
        if (jsonData._reasoning.原作タイプ) {
          console.log('📚 原作タイプ:', jsonData._reasoning.原作タイプ);
        }
        if (jsonData._reasoning.原作者名) {
          console.log('✍️ 原作者名:', jsonData._reasoning.原作者名);
        }
        console.log('[Extraction] === 判断理由終了 ===');
      }

      console.log('[Extraction] === 詳細終了 ===\n');

      return {
        作品名: jsonData.作品名,
        メディアタイプ: jsonData.メディアタイプ || 'anime',
        原作タイプ: jsonData.原作タイプ || 'other',
        原作者有無: jsonData.原作者有無 ?? false,
        原作者名: jsonData.原作者名 || null,
        店舗名: jsonData.店舗名,
        開催期間: eventPeriod,
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
        開催都道府県: jsonData.開催都道府県 || null,
        コピーライト: jsonData.コピーライト || null,
        TwitterURL: jsonData.TwitterURL || null,
        _reasoning: jsonData._reasoning || undefined,
        model,
        usage,
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
