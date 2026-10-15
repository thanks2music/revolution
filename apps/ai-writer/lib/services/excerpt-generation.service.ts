/**
 * 記事の抜粋 (frontmatter の `excerpt`) を LLM で書く (`excerpt-generation` step、2026-10-16 BOSS 決定。記事の改善プランの PR-4c)
 *
 * - プロンプト: `pipeline/6-meta-description.yaml` (Templates)。ここは値を差し込むだけ
 * - 根拠: 完成した記事の冒頭 (リード文と「この記事のポイント」)。どちらも確定値 (期間・会場数・描き下ろしの語) で組み立ててある。
 *   公式ページの本文は渡さない (以前はページの本文だけから書き、公式の古い文 (コナンの「6都市8会場」) や公式と違う語
 *   (ヒロアカの「描き起こし」を「描き下ろし」) を写した)
 * - 応答: `shared/schemas/excerpt-response.ts` (`{ excerpt: string }`)
 * - cron の経路 (`runMdxPipeline`) は旧来の `lib/claude/metadata-generator.ts` のまま (S5 で CLI と同じ経路へ寄せる)
 */
import { ExcerptResponseSchema } from '@revolution/schemas/excerpt-response';
import type { TokenUsage } from '@revolution/schemas/ai-provider-response';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import { METADATA_DEFAULTS } from '@/lib/claude/types';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import { parseJson } from '@/lib/services/subpage-extraction.service';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';

const EXCERPT_OPENAI_SCHEMA = zodToOpenAiSchema(ExcerptResponseSchema, 'ExcerptResponse');

/** 応答の上限。抜粋は 150 字ほどだが、Gemini は思考のトークンもここに含めて数えるので余裕を持たせる */
const MAX_OUTPUT_TOKENS = 4_000;

export interface ExcerptRequest {
  title: string;
  作品名: string | null;
  /** リード文 (MDX)。値は確定値で埋めてある */
  leadMdx: string;
  /** 「この記事のポイント」の枠 (MDX、`renderArticlePoints` の出力)。空なら枠なし */
  pointsBlock: string;
  /** 字数の上限 (既定は `METADATA_DEFAULTS.MAX_EXCERPT_LENGTH`) */
  maxLength?: number;
}

export interface ExcerptResult {
  excerpt: string;
  model: string;
  usage?: TokenUsage;
}

/** `escapeMdxText` などが書いた数値文字参照を文字に戻す (プロンプトと抜粋は MDX ではないため) */
function decodeNumericEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/** リード文の MDX を地の文にする (タグ・Markdown の記号を外し、段落を空白 1 つでつなぐ) */
export function mdxToPlainText(mdx: string): string {
  return decodeNumericEntities(
    mdx
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*|`/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 枠の MDX から箇条書きの行を取り出す (枠が空なら空の配列) */
export function pointsLinesOf(pointsBlock: string): string[] {
  return pointsBlock
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => decodeNumericEntities(line.slice(2).trim()))
    .filter((line) => line !== '');
}

/**
 * 応答の抜粋を 1 段落にそろえ、上限を超えたら切り詰める (末尾に「…」)。
 * 二重引用符 (半角の " と全角の “ ”) はかぎ括弧に置き換える (プロンプトでも禁じているが、Gemini が “港町レトロ” と書いた。
 * 半角の " は frontmatter の値を壊すことがある)。対にならない二重引用符は消す。
 * 一重引用符 (' ‘ ’) は名前のアポストロフィのことがあるので触らない
 */
export function normalizeExcerpt(text: string, maxLength: number): string {
  const oneLine = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/["“]([^"“”]*)["”]/g, '「$1」')
    .replace(/["“”]/g, '');
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 1).trimEnd()}…`;
}

/** 応答は返ったが読めなかった (形が違う・空)。トークンは使っているので、コストを記録できるよう usage を持つ */
export class ExcerptParseError extends Error {
  constructor(
    readonly model: string,
    readonly usage: TokenUsage | undefined,
    cause: unknown
  ) {
    super(`抜粋の応答を読めない: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ExcerptParseError';
  }
}

/**
 * LLM が書けなかったときの抜粋。リード文の先頭の文を上限まで使う (リード文は確定値で書いてあるので、事実と食い違わない)
 */
export function fallbackExcerpt(leadMdx: string, maxLength: number = METADATA_DEFAULTS.MAX_EXCERPT_LENGTH): string {
  return normalizeExcerpt(mdxToPlainText(leadMdx), maxLength);
}

export class ExcerptGenerationService {
  private readonly templateId = 'collabo-cafe';
  private readonly pipelineId = '6-meta-description';
  private readonly templateLoader: YamlTemplateLoaderService;
  private readonly aiProvider: AiProvider;

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader ?? new YamlTemplateLoaderService();
    this.aiProvider = aiProvider ?? createAiProvider();
  }

  /**
   * @throws プロンプトが無いとき、LLM の呼び出しに失敗したとき。応答を読めなければ {@link ExcerptParseError} (usage 付き)。
   *   呼び出し側は {@link fallbackExcerpt} で続ける
   */
  async generate(request: ExcerptRequest): Promise<ExcerptResult> {
    const maxLength = request.maxLength ?? METADATA_DEFAULTS.MAX_EXCERPT_LENGTH;
    const template = await this.templateLoader.loadModularTemplate(this.templateId, this.pipelineId, {
      includeSections: false,
      includeShared: false,
    });
    const instruction = template.prompts.write_excerpt;
    if (!instruction) {
      throw new Error(`${this.pipelineId}.yaml に prompts.write_excerpt がありません。pnpm sync:templates で Templates を同期してください`);
    }
    const points = pointsLinesOf(request.pointsBlock);
    // 1 回で置き換える (リード文などに `{{points}}` の文字列が含まれていても、そこへ展開しない)
    const values: Record<'title' | '作品名' | 'lead' | 'points' | 'max_length', string> = {
      title: request.title,
      作品名: request.作品名 ?? '(不明)',
      lead: mdxToPlainText(request.leadMdx) || '(なし)',
      points: points.length > 0 ? points.map((line) => `- ${line}`).join('\n') : '(なし)',
      max_length: String(maxLength),
    };
    const prompt = instruction.replace(/\{\{(title|作品名|lead|points|max_length)\}\}/g, (_, key: keyof typeof values) => values[key]);
    const response = await this.aiProvider.sendMessage(prompt, {
      stepId: 'excerpt-generation',
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: METADATA_DEFAULTS.TEMPERATURE,
      responseFormat: 'json',
      responseSchema: EXCERPT_OPENAI_SCHEMA,
    });
    let excerpt: string;
    try {
      excerpt = normalizeExcerpt(ExcerptResponseSchema.parse(parseJson(response.content)).excerpt, maxLength);
      if (excerpt === '') throw new Error('抜粋が空');
    } catch (error) {
      throw new ExcerptParseError(response.model, response.usage, error);
    }
    return { excerpt, model: response.model, usage: response.usage };
  }
}
