/**
 * Title Generation Service
 * YAML テンプレートを使用してコラボカフェ記事のタイトルを生成するサービス
 */

import {
  TitleGenerationRequest,
  TitleGenerationResult,
} from '@/lib/types/title-generation';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { ClaudeAPIService } from './claude-api.service';

/**
 * タイトル生成サービス
 */
export class TitleGenerationService {
  private templateLoader: YamlTemplateLoaderService;
  private claudeAPI: ClaudeAPIService;
  private readonly templateId = 'post-template-collabo-cafe-title';

  constructor(
    templateLoader?: YamlTemplateLoaderService,
    claudeAPI?: ClaudeAPIService
  ) {
    this.templateLoader = templateLoader || new YamlTemplateLoaderService();
    this.claudeAPI = claudeAPI || new ClaudeAPIService();
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

      // プロンプトを構築
      const prompt = this.buildPrompt(template.prompts.generate_title, request);

      // Claude APIを呼び出し
      // TODO: マルチプロバイダー対応 - 現在はClaude固定
      console.log(`🤖 Using AI Provider: Anthropic Claude (${this.claudeAPI['model']})`);
      const response = await this.claudeAPI['client'].messages.create({
        model: this.claudeAPI['model'],
        max_tokens: 500, // タイトルは短いので500で十分
        temperature: 0.7, // 創造性と正確性のバランス
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

      // レスポンスからタイトルを抽出
      const title = this.extractTitle(content.text);

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
   * @param generateTitlePrompt YAMLテンプレートの prompts.generate_title
   * @param request リクエストデータ
   * @returns 完成したプロンプト
   */
  private buildPrompt(
    generateTitlePrompt: string,
    request: TitleGenerationRequest
  ): string {
    // プロンプトテンプレートに実際のデータを埋め込む
    return `${generateTitlePrompt}

## 入力データ（RSS記事）

- タイトル: ${request.rss_title}
- URL: ${request.rss_link}
- 本文: ${request.rss_content.substring(0, 3000)}${request.rss_content.length > 3000 ? '...' : ''}

上記のRSS記事情報から、必要な情報（作品名、店舗名、開催日、略称、複数店舗情報など）を抽出し、
最適な記事タイトルを生成してください。

重要: タイトル文のみを出力し、説明文・理由・JSON・補足テキストなどは一切含めないでください。`;
  }

  /**
   * Claude APIのレスポンスからタイトルを抽出
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
 * シングルトンインスタンス
 */
export const titleGenerationService = new TitleGenerationService();
