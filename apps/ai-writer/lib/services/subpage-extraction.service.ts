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
import {
  GoodsSalesSchema,
  SubpageExtractionResponseSchema,
  type SubpageGoodsItem,
} from '@revolution/schemas/subpage-extraction-response';
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { createAiProvider } from '@/lib/ai/factory/ai-factory';
import type { TokenUsage } from '@revolution/schemas/ai-provider-response';
import { toExtractionMenuItems, toNoveltyNames, toStringList } from '@/lib/services/extraction.service';
import { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import type { SubpageKind, SubpageText } from '@/lib/services/category-image-extractor.service';
import { LLM_INPUT_BUDGET_CHARS, truncateForLlm } from '@/lib/utils/compact-html';
import { isRecord, toOptionalString } from '@/lib/utils/llm-values';
import { pageUrlKey } from '@/lib/utils/url';
import { zodToOpenAiSchema } from '@/lib/utils/zod-to-openai-schema';
import { EXTRACTION_THINKING_LEVEL } from '@/lib/config/gemini-models';

const SUBPAGE_EXTRACTION_OPENAI_SCHEMA = zodToOpenAiSchema(
  SubpageExtractionResponseSchema,
  'SubpageExtractionResponse'
);

/**
 * 応答の上限。メニューが数十品あるサイトでも切れないように。Gemini は思考のトークンもここに含めて数え、
 * 考える量 MEDIUM ではコナン (約 6 万字) で思考だけで約 9,600 使ったため、8,000 では切れた (2026-10-12)。
 * Claude の非ストリームの上限 (21,333) の内側に置く
 */
const MAX_OUTPUT_TOKENS = 16_000;

/** 1 ページから読み取れた事実 (入力のページと同じ順) */
export interface SubpageFacts {
  url: string;
  kind: SubpageKind;
  /** 会場の地域名 (venue のページで読み取れたときだけ) */
  area: string | null;
  メニュー詳細リスト: ExtractionMenuItem[] | null;
  /** グッズの品名・価格・販売方法 */
  グッズ詳細リスト: SubpageGoodsItem[] | null;
  ノベルティ名: string[] | null;
  キャラクター名: string[] | null;
}

export interface SubpageExtractionResult {
  pages: SubpageFacts[];
  model: string;
  usage?: TokenUsage;
}

/**
 * ページを、1 回の呼び出しの予算 (本文の合計の文字数) に収まるまとまりに分ける (順番は保つ)。
 * 1 ページで予算を超えるものは、そのページだけのまとまりにする (並べるときに切り詰める)。
 *
 * コナンでは下層ページと会場の案内ページが 13 件・約 10 万字あり、1 回に詰めると後半のページが空のまま渡って
 * 「ノベルティの無い会場」と読まれた (2026-10-12)。ページを落とさないため、分けて読む。
 */
export function batchPages(pages: SubpageText[], budget = LLM_INPUT_BUDGET_CHARS): SubpageText[][] {
  const batches: SubpageText[][] = [];
  let current: SubpageText[] = [];
  let size = 0;
  for (const page of pages) {
    if (current.length > 0 && size + page.text.length > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(page);
    size += page.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function sumUsage(usages: Array<TokenUsage | undefined>): TokenUsage | undefined {
  const present = usages.filter((usage): usage is TokenUsage => usage !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce((sum, usage) => ({
    promptTokens: sum.promptTokens + usage.promptTokens,
    completionTokens: sum.completionTokens + usage.completionTokens,
    totalTokens: sum.totalTokens + usage.totalTokens,
    cachedTokens: (sum.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
    cacheCreationTokens: (sum.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0),
  }));
}

/**
 * ページの本文をプロンプトに並べる。全体を {@link LLM_INPUT_BUDGET_CHARS} に収める
 * (先のページから順に予算を使い、足りなくなったページは切り詰める。通常は {@link batchPages} で分けてから呼ぶ)。
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

/** グッズの品目をそろえる。name の無い品目は捨て、販売方法は決まった値だけを受け付ける (それ以外は null) */
export function toGoodsItems(value: unknown): SubpageGoodsItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: SubpageGoodsItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const name = toOptionalString(raw.name);
    if (!name) continue;
    const sales = GoodsSalesSchema.safeParse(toOptionalString(raw.sales));
    items.push({ name, price: toOptionalString(raw.price) ?? null, sales: sales.success ? sales.data : null });
  }
  return items.length > 0 ? items : null;
}

function parseJson(content: string): unknown {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? content.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? (match[1] ?? match[0]) : content);
}

/** URL の照合用 (末尾の / と # 以降の違いを無視する) */
function urlKey(value: unknown): string {
  return typeof value === 'string' ? pageUrlKey(value) : '';
}

/**
 * 応答をページごとの事実にそろえる。URL で入力のページに対応づける。順番での対応づけは、応答のページ数が
 * 入力と同じときだけ行う (ページを飛ばした応答で、別のページの事実を写してしまわないように)。
 * 値の無いもの (`null`・空文字・`"null"`) は null にする。応答に無いページは、何も読めなかったものとして扱う。
 */
export function parseSubpageResponse(raw: unknown, pages: SubpageText[]): SubpageFacts[] {
  const items = isRecord(raw) && Array.isArray(raw.pages) ? raw.pages.filter(isRecord) : [];
  const byIndex = items.length === pages.length;
  return pages.map((page, index) => {
    const item =
      items.find((candidate) => urlKey(candidate.url) === urlKey(page.url)) ?? (byIndex ? items[index] : undefined);
    return {
      url: page.url,
      kind: page.kind,
      area: page.kind === 'venue' ? (toOptionalString(item?.area) ?? null) : null,
      メニュー詳細リスト: toExtractionMenuItems(item?.メニュー詳細リスト),
      グッズ詳細リスト: toGoodsItems(item?.グッズ詳細リスト),
      ノベルティ名: toNoveltyNames(item?.ノベルティ名),
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
    // 予算に収まるまとまりごとに呼ぶ (並列)。ページの順番は保つ。1 つのまとまりが失敗しても、他の結果は使う
    const batches = batchPages(request.pages);
    const settled = await Promise.allSettled(
      batches.map(async (pages) => {
        const prompt = instruction
          .replace('{{作品名}}', () => request.作品名 ?? '(不明)')
          .replace('{{pages}}', () => formatPagesForPrompt(pages));
        const response = await this.aiProvider.sendMessage(prompt, {
          stepId: 'subpage-extraction',
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          thinkingLevel: EXTRACTION_THINKING_LEVEL,
          responseFormat: 'json',
          responseSchema: SUBPAGE_EXTRACTION_OPENAI_SCHEMA,
          recordContext: { pageUrls: pages.map((page) => page.url) },
        });
        return { pages: parseSubpageResponse(parseJson(response.content), pages), response };
      })
    );

    const results = settled.flatMap((entry, index) => {
      if (entry.status === 'fulfilled') return [entry.value];
      console.error(
        `[subpage-extraction] ⚠️ ${batches[index].length} ページ分の抽出に失敗 (このまとまりは読めなかったものとする):`,
        entry.reason
      );
      return [];
    });
    if (results.length === 0) {
      throw settled[0].status === 'rejected' ? settled[0].reason : new Error('下層ページの抽出に失敗');
    }
    // 失敗したまとまりのページは「何も読めなかった」として返す (会場限定の書き分けは、読めないページがあれば行わない)
    const factsByUrl = new Map(results.flatMap((result) => result.pages).map((facts) => [facts.url, facts]));
    return {
      pages: request.pages.map((page) => factsByUrl.get(page.url) ?? parseSubpageResponse(null, [page])[0]),
      model: results[0].response.model,
      usage: sumUsage(results.map((result) => result.response.usage)),
    };
  }
}
