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
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import { parseJson } from '@/lib/services/subpage-extraction.service';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';

const EXCERPT_OPENAI_SCHEMA = zodToOpenAiSchema(ExcerptResponseSchema, 'ExcerptResponse');

/** 応答の上限。抜粋は 150 字ほどだが、Gemini は思考のトークンもここに含めて数えるので余裕を持たせる */
const MAX_OUTPUT_TOKENS = 4_000;
const TEMPERATURE = 0.5;

/**
 * 抜粋の字数の上限 (Templates の `shared/constraints.yaml` の meta_description.length.max)。これを超えたときだけ切り詰める
 */
export const EXCERPT_MAX_LENGTH = 160;

/**
 * プロンプトに伝える上限は、実際の上限よりこの字数だけ少なくする (推奨の 120〜150 字に収まる 140 字)。LLM は日本語の字数を
 * 数え違える (上限 150 で 152 字、140 で 151 字を返し、切り詰めで「…発売され…」と文の途中で切れた。2026-10-16 の dry-run)
 */
const PROMPT_LENGTH_MARGIN = 20;

/** 上限を超えたとき、最後の「。」で切ってもこの割合以上が残るなら、文の途中ではなくそこで切る */
const SENTENCE_CUT_MIN_RATIO = 0.6;

export interface ExcerptRequest {
  title: string;
  作品名: string | null;
  /** リード文 (MDX)。値は確定値で埋めてある */
  leadMdx: string;
  /** 「この記事のポイント」の枠 (MDX、`renderArticlePoints` の出力)。空なら枠なし */
  pointsBlock: string;
}

export interface ExcerptResult {
  excerpt: string;
  model: string;
  usage?: TokenUsage;
}

/** `escapeMdxText` などが書いた数値文字参照を文字に戻す (プロンプトと抜粋は MDX ではないため) */
function decodeNumericEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (entity, code: string) => {
    const value = Number(code);
    // Unicode の範囲外 (fromCodePoint が RangeError を投げる) はそのまま残す
    return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
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
 * 応答の抜粋を 1 段落にそろえ、上限を超えたら切り詰める。切り詰めは、最後の「。」までで本文の大半が残るならそこで切り、
 * そうでなければ文の途中で切って「…」を付ける。
 * 二重引用符 (半角の " と全角の “ ”) はかぎ括弧に置き換える (表記の規則。プロンプトでも禁じているが、Gemini が “港町レトロ” と
 * 書いた。frontmatter のエスケープは serializeFrontmatter が行う)。対にならない二重引用符は消す。
 * 一重引用符 (' ‘ ’) は名前のアポストロフィのことがあるので触らない
 */
export function normalizeExcerpt(text: string, maxLength: number): string {
  const oneLine = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/["“]([^"“”]*)["”]/g, '「$1」')
    .replace(/["“”]/g, '');
  // 字数はコードポイントで数える (サロゲートペアの途中で切らない)
  const chars = Array.from(oneLine);
  if (chars.length <= maxLength) return oneLine;
  const head = chars.slice(0, maxLength);
  const lastStop = head.lastIndexOf('。');
  if (lastStop + 1 >= maxLength * SENTENCE_CUT_MIN_RATIO) return head.slice(0, lastStop + 1).join('');
  return `${chars.slice(0, maxLength - 1).join('').trimEnd()}…`;
}

/** プロンプトが無い (Templates の同期漏れ)。LLM の一時的な失敗と違い、直すまで全記事が代替の抜粋になるので通知する */
export class ExcerptPromptMissingError extends Error {
  constructor(pipelineId: string) {
    super(`${pipelineId}.yaml に prompts.write_excerpt がありません。pnpm sync:templates で Templates を同期してください`);
    this.name = 'ExcerptPromptMissingError';
  }
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
 * LLM が書けなかったときの抜粋。リード文の最初の 1 文 (「。」まで) を使う (リード文は確定値で書いてあるので、事実と食い違わない)。
 * 2 文目以降にはノベルティの名前が並ぶことがあり、抜粋には書かない方針なので使わない (プロンプト評価 r1 の指摘)
 */
export function fallbackExcerpt(leadMdx: string, title: string, maxLength: number = EXCERPT_MAX_LENGTH): string {
  const text = mdxToPlainText(leadMdx);
  const end = firstSentenceEnd(text);
  const excerpt = normalizeExcerpt(end === -1 ? text : text.slice(0, end + 1), maxLength);
  // リード文が空なら記事のタイトル (frontmatter の excerpt は空にできない)
  return excerpt !== '' ? excerpt : normalizeExcerpt(title, maxLength);
}

/** 括弧 (「」『』) の外にある最初の「。」の位置。無ければ -1 (「モーニング娘。」のような名前の中の「。」で切らない) */
function firstSentenceEnd(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '「' || char === '『') depth++;
    else if ((char === '」' || char === '』') && depth > 0) depth--;
    else if (char === '。' && depth === 0) return i;
  }
  return -1;
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
   * @throws プロンプトが無ければ {@link ExcerptPromptMissingError}。LLM の呼び出しに失敗したとき。応答を読めなければ {@link ExcerptParseError} (usage 付き)。
   *   呼び出し側は {@link fallbackExcerpt} で続ける
   */
  async generate(request: ExcerptRequest): Promise<ExcerptResult> {
    const template = await this.templateLoader.loadModularTemplate(this.templateId, this.pipelineId, {
      includeSections: false,
      includeShared: false,
    });
    const instruction = template.prompts.write_excerpt;
    if (!instruction) throw new ExcerptPromptMissingError(this.pipelineId);
    const points = pointsLinesOf(request.pointsBlock);
    // 1 回で置き換える (リード文などに `{{points}}` の文字列が含まれていても、そこへ展開しない)
    const values: Record<string, string> = {
      title: request.title,
      作品名: request.作品名 ?? '(不明)',
      lead: mdxToPlainText(request.leadMdx) || '(なし)',
      points: points.length > 0 ? points.map((line) => `- ${line}`).join('\n') : '(なし)',
      max_length: String(EXCERPT_MAX_LENGTH - PROMPT_LENGTH_MARGIN),
    };
    const prompt = instruction.replace(/\{\{([^{}]+)\}\}/g, (match, key: string) => values[key] ?? match);
    const response = await this.aiProvider.sendMessage(prompt, {
      stepId: 'excerpt-generation',
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      responseFormat: 'json',
      responseSchema: EXCERPT_OPENAI_SCHEMA,
    });
    let excerpt: string;
    try {
      excerpt = normalizeExcerpt(ExcerptResponseSchema.parse(parseJson(response.content)).excerpt, EXCERPT_MAX_LENGTH);
      if (excerpt === '') throw new Error('抜粋が空');
    } catch (error) {
      throw new ExcerptParseError(response.model, response.usage, error);
    }
    return { excerpt, model: response.model, usage: response.usage };
  }
}
