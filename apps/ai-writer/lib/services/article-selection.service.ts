/**
 * Article Selection Service
 * RSS記事から公式情報元URLを検出し、記事生成対象にするか判定するサービス
 *
 * @description
 * マルチプロバイダー対応済み（2025-12-07）
 * AI_PROVIDER環境変数でプロバイダーを切り替え可能
 */

import {
  ArticleSelectionRequest,
  ArticleSelectionResult,
} from '@/lib/types/article-selection';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { MergedModularTemplate } from '@/lib/types/modular-template';

/**
 * 記事選別サービス
 */
export class ArticleSelectionService {
  private templateLoader: YamlTemplateLoaderService;
  private aiProvider: AiProvider;
  /** モジュール化テンプレートID */
  private readonly templateId = 'collabo-cafe';
  /** パイプラインID */
  private readonly pipelineId = '1-selection';

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.aiProvider = aiProvider || createAiProvider();
  }

  /**
   * RSS記事が記事生成対象かどうかを判定
   * @param request 記事選別リクエスト
   * @returns 選別結果
   */
  async shouldGenerateArticle(
    request: ArticleSelectionRequest
  ): Promise<ArticleSelectionResult> {
    try {
      console.log('[ArticleSelection] 記事選別開始:', request.rss_title);

      // モジュール化YAMLテンプレートを読み込み
      const template = await this.templateLoader.loadModularTemplate(
        this.templateId,
        this.pipelineId,
        { includeSections: false } // 記事選別ではセクション不要
      );

      // プロンプトを構築（YAMLテンプレート全体を含む）
      const prompt = this.buildPrompt(template, request);

      // デバッグ: 送信プロンプトをログ出力
      if (process.env.DEBUG_SELECTION_PROMPT === 'true') {
        console.log('\n[ArticleSelection] ========== 送信プロンプト全文 ==========');
        console.log(prompt);
        console.log('[ArticleSelection] ========== プロンプト終了 ==========\n');
      }

      // AI Provider経由でAPI呼び出し（マルチプロバイダー対応）
      const response = await this.aiProvider.sendMessage(prompt, {
        maxTokens: 2000, // HTML全文対応のため増加
        temperature: 0.3, // 判定は確実性を重視
        responseFormat: 'json',
      });

      // AI APIのレスポンス全文をログ出力（デバッグ用）
      console.log('\n[ArticleSelection] === AI APIレスポンス全文 ===');
      console.log(response.content);
      console.log(`[ArticleSelection] === レスポンス終了 (model: ${response.model}) ===\n`);

      // レスポンスをパース
      const result = this.parseResponse(response.content);

      console.log('[ArticleSelection] 選別結果:', {
        should_generate: result.should_generate,
        official_urls_count: result.official_urls.length,
        reason: result.reason,
      });

      return result;
    } catch (error) {
      console.error('[ArticleSelection] 記事選別エラー:', error);

      // エラー時はスキップ（安全側に倒す）
      return {
        should_generate: false,
        primary_official_url: null,
        official_urls: [],
        reason: `選別処理エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
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
    request: ArticleSelectionRequest
  ): string {
    // YAMLテンプレートのルール定義をプロンプトに含める
    const rulesSection = this.buildRulesSection(template);

    // 最終プロンプトを構築
    return `${template.prompts.selection}

${rulesSection}

---

## 入力データ

- rss_title: ${request.rss_title}
- rss_content: ${request.rss_content}
${request.site_domain ? `- site_domain: ${request.site_domain}` : ''}

---

上記の入力データを解析し、JSON形式でのみ出力してください。`;
  }

  /**
   * モジュール化YAMLテンプレートからルール定義セクションを構築
   * @param template モジュール化YAMLテンプレート
   * @returns ルール定義のテキスト
   */
  private buildRulesSection(template: MergedModularTemplate): string {
    const sections: string[] = [];

    // 公式URL判定基準（logic.official_url_detection）
    if (template.logic?.official_url_detection) {
      sections.push(`## 公式URL判定基準（必須）

${template.logic.official_url_detection}`);
    }

    // 出力形式の定義（output.schema）
    if (template.output?.schema) {
      // schema がオブジェクトの場合は JSON 文字列に変換
      const schemaStr = typeof template.output.schema === 'string'
        ? template.output.schema
        : JSON.stringify(template.output.schema, null, 2);
      sections.push(`## 出力形式（JSON Schema）

\`\`\`json
${schemaStr}
\`\`\``);
    }

    // プレースホルダー情報（参考）
    if (template.placeholders?.required) {
      const placeholdersList = template.placeholders.required
        .map((p: any) => `- ${p.name}: ${p.description || ''}`)
        .join('\n');
      sections.push(`## 入力パラメータ定義

${placeholdersList}`);
    }

    return sections.join('\n\n');
  }

  /**
   * AI APIからのレスポンスをパース
   * @param response レスポンステキスト
   * @returns パース済みの選別結果
   */
  private parseResponse(response: string): ArticleSelectionResult {
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
          console.error('[ArticleSelection] JSON not found in response:', response);
          throw new Error('No JSON found in response');
        }

        jsonData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }

      // 必須フィールドの検証
      if (typeof jsonData.should_generate !== 'boolean') {
        throw new Error('Missing or invalid should_generate field');
      }

      if (
        jsonData.primary_official_url !== null &&
        typeof jsonData.primary_official_url !== 'string'
      ) {
        throw new Error('Invalid primary_official_url field');
      }

      if (!Array.isArray(jsonData.official_urls)) {
        throw new Error('Missing or invalid official_urls field');
      }

      // パース済みデータの詳細ログ（デバッグ用）
      console.log('\n[ArticleSelection] === パース済みデータ詳細 ===');
      console.log('should_generate:', jsonData.should_generate);
      console.log('primary_official_url:', jsonData.primary_official_url);
      console.log('official_urls (公式URL一覧):');
      if (jsonData.official_urls.length === 0) {
        console.log('  (0件)');
      } else {
        jsonData.official_urls.forEach((url: string, index: number) => {
          console.log(`  [${index + 1}] ${url}`);
        });
      }
      console.log('reason:', jsonData.reason || '理由なし');
      console.log('[ArticleSelection] === 詳細終了 ===\n');

      return {
        should_generate: jsonData.should_generate,
        primary_official_url: jsonData.primary_official_url,
        official_urls: jsonData.official_urls,
        reason: jsonData.reason || '理由なし',
      };
    } catch (error) {
      console.error('[ArticleSelection] Failed to parse response:', error);
      throw new Error(
        `Failed to parse selection response: ${error instanceof Error ? error.message : 'Unknown error'}`
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
let _articleSelectionService: ArticleSelectionService | null = null;

export function getArticleSelectionService(): ArticleSelectionService {
  if (!_articleSelectionService) {
    _articleSelectionService = new ArticleSelectionService();
  }
  return _articleSelectionService;
}

/**
 * @deprecated Use getArticleSelectionService() instead
 * シングルトンインスタンスへの直接アクセスは非推奨です。
 * 遅延初期化のため、getArticleSelectionService() を使用してください。
 */
export const articleSelectionService = {
  get instance() {
    return getArticleSelectionService();
  },
  shouldGenerateArticle: (request: ArticleSelectionRequest) =>
    getArticleSelectionService().shouldGenerateArticle(request),
};
