/**
 * 「この記事のポイント」の「本イベントの特徴」を LLM で書く (`article-points` step、2026-10-15 BOSS 決定)
 *
 * - プロンプト: `pipeline/4.5-article-points.yaml` (Templates)。ここは値を差し込むだけ
 * - 根拠: 抽出結果の要約と、公式サイトのトップ・下層・会場のページの本文 (取得済みのもの。追加の通信はしない)
 * - 応答: `shared/schemas/article-points-response.ts` (`{ features: string[] }`。数に上限なし)
 * - 失敗しても記事は止めない (呼び出し側が事実の行だけで枠を作る)
 */
import { ArticlePointsResponseSchema } from '@revolution/schemas/article-points-response';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { TokenUsage } from '@revolution/schemas/ai-provider-response';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import { menuItemsOf } from '@/lib/services/vision-api/merge-vision-into-extraction';
import { formatPagesForPrompt, parseJson, type PromptPage } from '@/lib/services/subpage-extraction.service';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';

const ARTICLE_POINTS_OPENAI_SCHEMA = zodToOpenAiSchema(ArticlePointsResponseSchema, 'ArticlePointsResponse');

/** 応答の上限。特徴は数行だが、Gemini は思考のトークンもここに含めて数えるので余裕を持たせる */
const MAX_OUTPUT_TOKENS = 8_000;

export interface ArticlePointsRequest {
  作品名: string | null;
  /** 既に枠に並ぶ事実の行 (特徴で繰り返させない) */
  factLines: string[];
  extraction: ExtractionResult;
  /** 根拠にするページ (トップ・下層・会場の案内ページの順。予算を超えると後ろから切り詰められる) */
  pages: PromptPage[];
}

export interface ArticlePointsResult {
  features: string[];
  model: string;
  usage?: TokenUsage;
}

/**
 * プロンプトに渡す抽出結果の要約 (特徴を書く材料になる名前だけ。価格・日付・会場は事実の行と本文にある)。
 * ノベルティは特徴に書かせないので渡さない
 */
export function summarizeExtraction(extraction: ExtractionResult): Record<string, unknown> {
  return {
    テーマ名: extraction.テーマ名 ?? null,
    キャラクター名: extraction.キャラクター名 ?? null,
    メニュー: menuItemsOf(extraction).map((item) => (item.character ? `${item.name} (${item.character})` : item.name)),
    グッズ名: extraction.グッズ名 ?? null,
  };
}

/** 応答から特徴の配列を取り出す (空の項目は捨てる)。形が違えば例外 */
export function parseArticlePointsResponse(content: string): string[] {
  return ArticlePointsResponseSchema.parse(parseJson(content)).features.filter((feature) => feature.trim() !== '');
}

/**
 * 応答は返ったが読めなかった (形が違う・途中で切れた)。トークンは使っているので、コストを記録できるよう usage を持つ
 */
export class ArticlePointsParseError extends Error {
  constructor(
    readonly model: string,
    readonly usage: TokenUsage | undefined,
    cause: unknown
  ) {
    super(`本イベントの特徴の応答を読めない: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ArticlePointsParseError';
  }
}

export class ArticlePointsGenerationService {
  private readonly templateId = 'collabo-cafe';
  private readonly pipelineId = '4.5-article-points';
  private readonly templateLoader: YamlTemplateLoaderService;
  private readonly aiProvider: AiProvider;

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader ?? new YamlTemplateLoaderService();
    this.aiProvider = aiProvider ?? createAiProvider();
  }

  /**
   * @throws プロンプトが無いとき、LLM の呼び出しに失敗したとき。応答を読めなければ {@link ArticlePointsParseError} (usage 付き)。
   *   呼び出し側は事実の行だけで続ける
   */
  async generate(request: ArticlePointsRequest): Promise<ArticlePointsResult> {
    const template = await this.templateLoader.loadModularTemplate(this.templateId, this.pipelineId, {
      includeSections: false,
      includeShared: false,
    });
    const instruction = template.prompts.write_features;
    if (!instruction) {
      throw new Error(`${this.pipelineId}.yaml に prompts.write_features がありません。pnpm sync:templates で Templates を同期してください`);
    }
    // 1 回で置き換える (作品名などに `{{pages}}` の文字列が含まれていても、そこへ展開しない)
    const values: Record<string, string> = {
      作品名: request.作品名 ?? '(不明)',
      facts: request.factLines.length > 0 ? request.factLines.map((line) => `- ${line}`).join('\n') : '(なし)',
      extraction: JSON.stringify(summarizeExtraction(request.extraction), null, 2),
      pages: request.pages.length > 0 ? formatPagesForPrompt(request.pages) : '(なし)',
    };
    const prompt = instruction.replace(/\{\{(作品名|facts|extraction|pages)\}\}/g, (_, key: string) => values[key]);
    const response = await this.aiProvider.sendMessage(prompt, {
      stepId: 'article-points',
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      responseFormat: 'json',
      responseSchema: ARTICLE_POINTS_OPENAI_SCHEMA,
      recordContext: { pageUrls: request.pages.map((page) => page.url) },
    });
    let features: string[];
    try {
      features = parseArticlePointsResponse(response.content);
    } catch (error) {
      throw new ArticlePointsParseError(response.model, response.usage, error);
    }
    return { features, model: response.model, usage: response.usage };
  }
}
