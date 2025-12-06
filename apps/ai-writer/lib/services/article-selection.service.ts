/**
 * Article Selection Service
 * RSS記事から公式情報元URLを検出し、記事生成対象にするか判定するサービス
 */

import {
  ArticleSelectionRequest,
  ArticleSelectionResult,
} from '@/lib/types/article-selection';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { ClaudeAPIService } from './claude-api.service';

/**
 * 記事選別サービス
 */
export class ArticleSelectionService {
  private templateLoader: YamlTemplateLoaderService;
  private claudeAPI: ClaudeAPIService;
  private readonly templateId = 'collabo-cafe-selection';

  constructor(
    templateLoader?: YamlTemplateLoaderService,
    claudeAPI?: ClaudeAPIService
  ) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.claudeAPI = claudeAPI || new ClaudeAPIService();
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

      // YAMLテンプレートを読み込み
      const template = await this.templateLoader.loadTemplate(this.templateId);

      // プロンプトを構築
      const prompt = this.buildPrompt(template.prompts.selection, request);

      // Claude APIを呼び出し
      // TODO: マルチプロバイダー対応 - 現在はClaude固定
      console.log(`🤖 Using AI Provider: Anthropic Claude (${this.claudeAPI['model']})`);
      const response = await this.claudeAPI['client'].messages.create({
        model: this.claudeAPI['model'],
        max_tokens: 2000, // HTML全文対応のため増加
        temperature: 0.3, // 判定は確実性を重視
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      // Claude APIのレスポンス全文をログ出力（デバッグ用）
      console.log('\n[ArticleSelection] === Claude APIレスポンス全文 ===');
      console.log(content.text);
      console.log('[ArticleSelection] === レスポンス終了 ===\n');

      // レスポンスをパース
      const result = this.parseResponse(content.text);

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
   * @param selectionPrompt YAMLテンプレートの prompts.selection
   * @param request リクエストデータ
   * @returns 完成したプロンプト
   */
  private buildPrompt(
    selectionPrompt: string,
    request: ArticleSelectionRequest
  ): string {
    // プロンプトテンプレートに実際のデータを埋め込む
    return `${selectionPrompt}

## 入力データ

- rss_title: ${request.rss_title}
- rss_content: ${request.rss_content}
${request.site_domain ? `- site_domain: ${request.site_domain}` : ''}

上記の入力データを解析し、JSON形式でのみ出力してください。`;
  }

  /**
   * Claude APIからのレスポンスをパース
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
 * シングルトンインスタンス
 */
export const articleSelectionService = new ArticleSelectionService();
