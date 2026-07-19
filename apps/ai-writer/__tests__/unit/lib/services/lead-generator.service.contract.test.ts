/**
 * Layer 2 contract tests for LeadGeneratorService (Sprint C-β P11 Phase 2f).
 *
 * Focus:
 * - mock AiProvider を DI → LLM Fallback path (`llmFallback`) の contract verify
 * - `sendMessage` が `responseSchema` (Zod → JSON schema strict mode) で呼ばれる
 * - LLM 応答が `LeadSlotsSchema` で parse される
 * - `usedTemplate` = LEAD_FALLBACK_TEMPLATE_ID + `fallbackReason` 記録
 * - Provider が invalid JSON / schema mismatch / rejected promise を返した場合の staticFallback degrade 挙動 (R3 対応)
 * - N9-A regression: rule-driven success path で mock provider が呼ばれない (Layer 1 assert 補完)
 *
 * Sprint C-β P0 pattern を継承 (`responseSchema` + `LeadSlotsSchema.parse`)。
 */

import * as path from 'path';

import type {
  AiProvider,
  ArticleGenerationRequest,
  GeneratedArticle,
  RssExtractionInput,
  RssExtractionResult,
  SendMessageOptions,
  SendMessageResult,
} from '../../../../lib/ai/providers/ai-provider.interface';
import {
  LEAD_FALLBACK_TEMPLATE_ID,
  type LeadSlots,
} from '@revolution/schemas/lead-response';

import {
  LeadGeneratorService,
  resetLeadGeneratorService,
  type EnrichedData,
} from '../../../../lib/services/lead-generator.service';
import {
  MediaFormResolverService,
  resetMediaFormResolverService,
} from '../../../../lib/services/media-form-resolver.service';
import {
  MediaTypeMapperService,
  resetMediaTypeMapperService,
} from '../../../../lib/services/media-type-mapper.service';
import { TextPlaceholderReplacerService } from '../../../../lib/services/text-placeholder-replacer.service';

const mediaTypeMappingYamlPath = path.join(
  __dirname,
  '../../../../templates/config/media-type-mapping.yaml'
);
const leadYamlPath = path.join(
  __dirname,
  '../../../../templates/collabo-cafe/sections/01-lead.yaml'
);

/**
 * Minimal mock AiProvider (contract test 用、必要 method のみ実装)。
 */
function makeMockProvider(): AiProvider & {
  sendMessage: jest.Mock<Promise<SendMessageResult>, [string, SendMessageOptions?]>;
} {
  return {
    sendMessage: jest.fn(),
    // 他の method は使わないので noop stub (interface 互換のため)
    generateArticle: jest.fn<Promise<GeneratedArticle>, [ArticleGenerationRequest]>(),
    generateSlug: jest.fn<Promise<string>, [string]>(),
    extractFromRss: jest.fn<Promise<RssExtractionResult>, [RssExtractionInput]>(),
    generateExcerpt: jest.fn<Promise<string>, [string, number]>(),
    testConnection: jest.fn<Promise<boolean>, []>(),
    getModel: jest.fn<string, []>(),
    getName: jest.fn<string, []>(),
  } as unknown as AiProvider & {
    sendMessage: jest.Mock<Promise<SendMessageResult>, [string, SendMessageOptions?]>;
  };
}

// ============================================================================
// Test setup
// ============================================================================

/**
 * Fully-populated `EnrichedData` fixture for direct `fallback()` invocation.
 * `fallback()` は enriched (derived vars 含む) を受け取るため、test では手組み。
 */
function makeEnriched(overrides: Partial<EnrichedData> = {}): EnrichedData {
  return {
    // TextPlaceholderData 必須 fields
    作品名: 'テスト作品',
    店舗名: 'テストカフェ',
    メディアタイプ: 'manga',
    原作タイプ: 'manga_based',
    原作者有無: true,
    原作者名: 'テスト先生',
    キャラクター名: ['キャラA', 'キャラB'],
    works: [{ title: 'テスト作品', is_primary: true }],
    store: { name: 'テストカフェ' },
    開催期間: {
      開始: { 年: '2026年', 日付: '5月1日' },
      終了: { 年: '2026年', 日付: '6月30日', 未定: false },
    },
    // EnrichedData 派生 fields
    primary_work: { title: 'テスト作品', is_primary: true },
    secondary_works: [],
    is_multi_work: false,
    has_studio_name: false,
    has_director_name: false,
    has_series_name: false,
    メディア形態表記: '漫画',
    member_separator: '、',
    メディアタイプ_label: '漫画',
    is_idol_or_utaite: false,
    原作者名_formatted: 'テスト先生',
    has_multiple_authors: false,
    ...overrides,
  };
}

function makeService(overrides: {
  aiProviderFactory?: () => AiProvider;
}) {
  const mediaFormResolver = new MediaFormResolverService(mediaTypeMappingYamlPath);
  const mediaTypeMapper = new MediaTypeMapperService(mediaTypeMappingYamlPath);
  const textReplacer = new TextPlaceholderReplacerService();
  return new LeadGeneratorService({
    mediaFormResolver,
    mediaTypeMapper,
    textReplacer,
    aiProviderFactory: overrides.aiProviderFactory,
    yamlPath: leadYamlPath,
  });
}

afterEach(() => {
  resetLeadGeneratorService();
  resetMediaFormResolverService();
  resetMediaTypeMapperService();
});

// ============================================================================
// describe 1: mock provider DI → LLM fallback contract
// ============================================================================

describe('LeadGeneratorService.fallback - LLM path (mock AiProvider DI)', () => {
  it('sendMessage が responseSchema=LeadSlotsResponse で呼ばれる (Sprint C-β P0 pattern)', async () => {
    const mockProvider = makeMockProvider();
    const validLlmSlots: LeadSlots = {
      agent: 'テスト先生',
      verb: 'による',
      adjective: '人気',
      mediaForm: '漫画',
      workTitle: 'テスト作品',
    };
    mockProvider.sendMessage.mockResolvedValue({
      content: JSON.stringify(validLlmSlots),
      model: 'gpt-5.4-mini',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const service = makeService({ aiProviderFactory: () => mockProvider });
    const enriched = makeEnriched();

    const result = await service.fallback(enriched, 'output_too_short');

    expect(mockProvider.sendMessage).toHaveBeenCalledTimes(1);
    const [prompt, options] = mockProvider.sendMessage.mock.calls[0]!;

    // prompt 検証: 4 スロット構造 + §6.2 対訳マップの指示を含む
    expect(prompt).toContain('4 スロット構造');
    expect(prompt).toContain('§6.2');
    expect(prompt).toContain('mediaForm');
    expect(prompt).toContain('workTitle');
    expect(prompt).toContain('テスト作品'); // 作品名が prompt に含まれる
    expect(prompt).toContain('output_too_short'); // fallbackReason が debug info として含まれる

    // options 検証: responseSchema が LeadSlotsResponse で渡される
    expect(options).toBeDefined();
    expect(options?.responseFormat).toBe('json');
    expect(options?.responseSchema).toBeDefined();
    expect(options?.responseSchema?.name).toBe('LeadSlotsResponse');
    expect(options?.responseSchema?.schema).toBeDefined();
    // temperature は 0.3 (LLM Fallback 内で明示)
    expect(options?.temperature).toBe(0.3);

    // result 検証
    expect(result.usedTemplate).toBe(LEAD_FALLBACK_TEMPLATE_ID);
    expect(result.fallbackReason).toBe('output_too_short');
    expect(result.slots).toEqual(validLlmSlots);
    expect(result.leadMdx).toContain('テスト先生');
    expect(result.leadMdx).toContain('漫画');
    expect(result.leadMdx).toContain('テスト作品');
    expect(result.leadMdx).toContain('テストカフェ');
  });

  // NOTE: 過去は「invalid JSON / schema mismatch で throw」を assert する 2 test を持っていたが、
  // R3 指摘 (llmFallback throw で pipeline 全体 abort) を受けて `llmFallback()` は catch し
  // staticFallback に degrade する挙動に変更したため、これら 2 test は正しい degrade behavior を
  // assert する describe 4 (末尾) に置換済 (LLM path throw → static degrade)。

  it('複数作品コラボの enriched でも prompt に is_multi_work 情報が反映される', async () => {
    const mockProvider = makeMockProvider();
    mockProvider.sendMessage.mockResolvedValue({
      content: JSON.stringify({
        agent: null,
        verb: null,
        adjective: '人気',
        mediaForm: 'キャラクター',
        workTitle: 'サンリオ',
      }),
      model: 'gpt-5.4-mini',
    });

    const service = makeService({ aiProviderFactory: () => mockProvider });
    const enriched = makeEnriched({
      is_multi_work: true,
      works: [
        { title: 'サンリオ', is_primary: true },
        { title: 'サンエックス', is_primary: false },
      ],
      作品名: 'サンリオ',
    });

    await service.fallback(enriched, 'all_conditions_missed');
    const [prompt] = mockProvider.sendMessage.mock.calls[0]!;

    expect(prompt).toContain('複数作品コラボ');
    expect(prompt).toContain('はい');
    expect(prompt).toContain('サンリオ × サンエックス');
  });

  it('fallbackReason 別に prompt に debug 情報が反映される', async () => {
    const mockProvider = makeMockProvider();
    mockProvider.sendMessage.mockResolvedValue({
      content: JSON.stringify({
        agent: null,
        verb: null,
        adjective: '人気',
        mediaForm: '漫画',
        workTitle: 'X',
      }),
      model: 'gpt-5.4-mini',
    });

    const service = makeService({ aiProviderFactory: () => mockProvider });
    const enriched = makeEnriched();

    // 各 fallback reason で prompt に該当理由が debug info として含まれる
    const reasons = [
      'all_conditions_missed',
      'too_many_unreplaced_placeholders',
      'output_too_short',
      'output_empty',
      'template_render_error',
    ] as const;

    for (const reason of reasons) {
      mockProvider.sendMessage.mockClear();
      await service.fallback(enriched, reason);
      const [prompt] = mockProvider.sendMessage.mock.calls[0]!;
      expect(prompt).toContain(reason);
    }
  });
});

// ============================================================================
// describe 2: mock provider DI → rule-driven success path (LLM 呼ばれない)
// ============================================================================

describe('LeadGeneratorService.generate - rule-driven success path (LLM not called)', () => {
  it('N9-A regression: character + キャラクター名 で rule-driven 成功、mock provider が呼ばれない', async () => {
    const mockProvider = makeMockProvider();
    const service = makeService({ aiProviderFactory: () => mockProvider });

    const result = await service.generate({
      メディアタイプ: 'character',
      原作タイプ: 'character_brand',
      原作者有無: false,
      キャラクター名: ['ハローキティ', 'マイメロディ'],
      works: [{ title: 'サンリオ', is_primary: true }],
      store: { name: 'サンリオカフェ' },
      開催期間: {
        開始: { 年: '2026年', 日付: '5月1日' },
        終了: { 年: '2026年', 日付: '6月30日', 未定: false },
      },
    });

    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
    expect(result.usedTemplate).toBe('lead_character_with_characters');
    expect(result.leadMdx).toContain('らをイメージした'); // N9-A テンプレ維持
    expect(result.fallbackReason).toBeUndefined();
  });

  it('rule-driven 成功時、AiProvider DI 済みでも sendMessage が呼ばれない (Fallback 未発火)', async () => {
    const mockProvider = makeMockProvider();
    const service = makeService({ aiProviderFactory: () => mockProvider });

    const result = await service.generate({
      メディアタイプ: 'anime',
      原作タイプ: 'manga_based',
      原作者有無: true,
      原作者名: '芥見下々先生',
      works: [{ title: '呪術廻戦', is_primary: true }],
      store: { name: 'BOX cafe&space' },
      開催期間: {
        開始: { 年: '2026年', 日付: '5月1日' },
        終了: { 年: '2026年', 日付: '6月30日', 未定: false },
      },
    });

    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
    expect(result.usedTemplate).toBe('lead_author_only');
    expect(result.fallbackReason).toBeUndefined();
  });
});

// ============================================================================
// describe 3: static fallback (AiProvider 未 DI) → LLM 経路と別
// ============================================================================

describe('LeadGeneratorService.fallback - static path (no AiProvider)', () => {
  it('AiProvider 未 DI 時、fallback は lead_generic を強制採用、LLM 呼び出しなし', async () => {
    const mockProvider = makeMockProvider();
    // aiProvider を渡さない
    const service = makeService({});
    const enriched = makeEnriched();

    const result = await service.fallback(enriched, 'output_too_short');

    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
    expect(result.usedTemplate).toBe(LEAD_FALLBACK_TEMPLATE_ID);
    expect(result.fallbackReason).toBe('output_too_short');
    // lead_generic テンプレの内容 (「人気作品「」」形式) を含む
    expect(result.leadMdx).toContain('人気作品');
    expect(result.leadMdx).toContain('テスト作品');
    expect(result.leadMdx).toContain('テストカフェ');
  });
});

// ============================================================================
// describe 4: LLM fallback throw → static fallback degrade (R3)
// ============================================================================
//
// R3 指摘: `llmFallback()` の `provider.sendMessage()` / `JSON.parse` / `LeadSlotsSchema.parse`
// はいずれも throw 可能 (timeout / rate limit / network / invalid JSON / schema mismatch)。
// 過去は uncaught で pipeline 全体を abort させていたが、staticFallback という deterministic な
// degrade path が存在するため fallback-of-fallback として静的テンプレへ落とすのが正しい挙動。
// 本 test で rejected promise / SyntaxError の 2 経路が staticFallback に degrade することを assert する。

describe('LeadGeneratorService.fallback - LLM path throw → static degrade (R3)', () => {
  it('provider.sendMessage が reject した場合 staticFallback に degrade (pipeline abort させない)', async () => {
    const failingProvider = {
      sendMessage: jest.fn().mockRejectedValue(new Error('network timeout')),
    } as unknown as AiProvider;
    const service = makeService({ aiProviderFactory: () => failingProvider });
    const enriched = makeEnriched();

    const result = await service.fallback(enriched, 'output_empty');

    expect(failingProvider.sendMessage).toHaveBeenCalledTimes(1);
    expect(result.usedTemplate).toBe(LEAD_FALLBACK_TEMPLATE_ID);
    expect(result.fallbackReason).toBe('output_empty');
    expect(result.leadMdx).toContain('人気作品'); // lead_generic テンプレへ degrade
  });

  it('provider が invalid JSON を返した場合 staticFallback に degrade (JSON.parse SyntaxError catch)', async () => {
    const invalidJsonProvider = {
      sendMessage: jest.fn().mockResolvedValue({
        content: '{ this is not valid JSON',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    } as unknown as AiProvider;
    const service = makeService({ aiProviderFactory: () => invalidJsonProvider });
    const enriched = makeEnriched();

    const result = await service.fallback(enriched, 'too_many_unreplaced_placeholders');

    expect(result.usedTemplate).toBe(LEAD_FALLBACK_TEMPLATE_ID);
    expect(result.fallbackReason).toBe('too_many_unreplaced_placeholders');
    expect(result.leadMdx).toContain('人気作品'); // lead_generic テンプレへ degrade
  });
});
