/**
 * 下層ページの抽出 (`subpage-extraction` step)
 *
 * 2-extraction (detail-extraction) はトップページしか読まない。2026-10-12 の実走で、コナン
 * (conan-cafe.jp) はメニューページに約 27 品あるのにトップに抜粋された 5 品しか記事に入らず、
 * ヒロアカはノベルティが会場ごとの案内ページにしか書かれていなかった。そこで、画像の抽出で取得済みの
 * 下層ページと会場の案内ページの本文を、1 回の LLM 呼び出しでまとめて読む。
 *
 * - プロンプト: `pipeline/2.5-subpage-extraction.yaml` (Templates)。ページの中身だけをここで差し込む
 * - 応答: `shared/schemas/subpage-extraction-response.ts`。ページごとに返させる
 *   (会場によって違うノベルティを書き分けるため。合わせ方は `merge-subpage-into-extraction.ts`)
 */
import { SubpageExtractionResponseSchema } from '@revolution/schemas/subpage-extraction-response';
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { TokenUsage } from '@revolution/schemas/ai-provider-response';
import { toExtractionMenuItems, toStringList } from '@/lib/services/extraction.service';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import type { SubpageKind, SubpageText } from '@/lib/services/category-image-extractor.service';
import { LLM_INPUT_BUDGET_CHARS, truncateForLlm } from '@/lib/utils/compact-html';
import { isRecord, toOptionalString } from '@/lib/utils/llm-values';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';

const SUBPAGE_EXTRACTION_OPENAI_SCHEMA = zodToOpenAiSchema(
  SubpageExtractionResponseSchema,
  'SubpageExtractionResponse'
);

/** 応答の上限。メニューが数十品あるサイトでも切れないように */
const MAX_OUTPUT_TOKENS = 8000;

/** 1 ページから読み取れた事実 (入力のページと同じ順) */
export interface SubpageFacts {
  url: string;
  kind: SubpageKind;
  /** 会場の地域名 (venue のページで読み取れたときだけ) */
  area: string | null;
  メニュー詳細リスト: ExtractionMenuItem[] | null;
  グッズ名: string[] | null;
  ノベルティ名: string[] | null;
  キャラクター名: string[] | null;
}

export interface SubpageExtractionResult {
  pages: SubpageFacts[];
  model: string;
  usage?: TokenUsage;
}

/**
 * ページの本文をプロンプトに並べる。全体を {@link LLM_INPUT_BUDGET_CHARS} に収める
 * (先のページから順に予算を使い、足りなくなったページは切り詰める)。
 */
export function formatPagesForPrompt(pages: SubpageText[], budget = LLM_INPUT_BUDGET_CHARS): string {
  let remaining = budget;
  return pages
    .map((page, index) => {
      const { text, truncated } = truncateForLlm(page.text, Math.max(0, remaining));
      remaining -= text.length;
      return [
        `### ページ ${index + 1}`,
        `- URL: ${page.url}`,
        `- 種類: ${page.kind}`,
        '',
        text + (truncated ? '\n(以下省略)' : ''),
      ].join('\n');
    })
    .join('\n\n');
}

function parseJson(content: string): unknown {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? content.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? (match[1] ?? match[0]) : content);
}

/**
 * 応答をページごとの事実にそろえる。URL で入力のページに対応づけ、無ければ順番で対応づける。
 * 値の無いもの (`null`・空文字・`"null"`) は null にする。応答に無いページは、何も読めなかったものとして扱う。
 */
export function parseSubpageResponse(raw: unknown, pages: SubpageText[]): SubpageFacts[] {
  const items = isRecord(raw) && Array.isArray(raw.pages) ? raw.pages.filter(isRecord) : [];
  return pages.map((page, index) => {
    const item = items.find((candidate) => candidate.url === page.url) ?? items[index];
    return {
      url: page.url,
      kind: page.kind,
      area: page.kind === 'venue' ? (toOptionalString(item?.area) ?? null) : null,
      メニュー詳細リスト: toExtractionMenuItems(item?.メニュー詳細リスト),
      グッズ名: toStringList(item?.グッズ名),
      ノベルティ名: toStringList(item?.ノベルティ名),
      キャラクター名: toStringList(item?.キャラクター名),
    };
  });
}

export class SubpageExtractionService {
  private readonly templateId = 'collabo-cafe';
  private readonly pipelineId = '2.5-subpage-extraction';
  private readonly templateLoader: YamlTemplateLoaderService;
  private readonly aiProvider: AiProvider;

  constructor(templateLoader?: YamlTemplateLoaderService, aiProvider?: AiProvider) {
    this.templateLoader = templateLoader ?? new YamlTemplateLoaderService();
    this.aiProvider = aiProvider ?? createAiProvider();
  }

  /**
   * 下層ページから事実を読む。ページが無ければ呼ばない (null)。
   *
   * @throws LLM の呼び出しや応答の解析に失敗したとき (呼び出し側は記事を止めずに続ける)
   */
  async extract(request: { 作品名: string | null; pages: SubpageText[] }): Promise<SubpageExtractionResult | null> {
    if (request.pages.length === 0) return null;

    const template = await this.templateLoader.loadModularTemplate(this.templateId, this.pipelineId, {
      includeSections: false,
      includeShared: false,
    });
    const instruction = template.prompts.extract_subpages;
    if (!instruction) {
      throw new Error(`${this.pipelineId}.yaml に prompts.extract_subpages がありません`);
    }
    const prompt = instruction
      .replace('{{作品名}}', request.作品名 ?? '(不明)')
      .replace('{{pages}}', formatPagesForPrompt(request.pages));

    const response = await this.aiProvider.sendMessage(prompt, {
      stepId: 'subpage-extraction',
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      responseFormat: 'json',
      responseSchema: SUBPAGE_EXTRACTION_OPENAI_SCHEMA,
      recordContext: { pageUrls: request.pages.map((page) => page.url) },
    });

    return {
      pages: parseSubpageResponse(parseJson(response.content), request.pages),
      model: response.model,
      usage: response.usage,
    };
  }
}
