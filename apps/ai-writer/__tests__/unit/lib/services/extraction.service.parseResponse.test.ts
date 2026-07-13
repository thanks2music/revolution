/**
 * Layer 2 contract tests for ExtractionService.parseResponse (via extractFromOfficialSite).
 *
 * Verifies the Sprint C-β P0 safeParse-then-fallback behavior added to parseResponse:
 * - Schema-conforming LLM response → validated data used downstream
 * - Non-conforming response → warning logged, lenient legacy path still returns a result
 * - Provider-agnostic (Anthropic/Gemini also honor the runtime validation gate)
 */

import { ExtractionService } from '@/lib/services/extraction.service';
import type {
  AiProvider,
  SendMessageOptions,
  SendMessageResult,
} from '@/lib/ai/providers/ai-provider.interface';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

function stubTemplateLoader(): YamlTemplateLoaderService {
  return {
    loadModularTemplate: jest.fn().mockResolvedValue({
      metadata: { name: 'test' },
      prompts: { extraction: 'test prompt' },
      derived_variables: {},
      section_selection: {},
      section_dependencies: {},
      sections: {},
    }),
  } as unknown as YamlTemplateLoaderService;
}

function stubAiProvider(response: string): AiProvider {
  return {
    sendMessage: jest.fn(
      async (_prompt: string, _options?: SendMessageOptions): Promise<SendMessageResult> => ({
        content: response,
        model: 'test-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
    ),
    generateArticle: jest.fn(),
    generateSlug: jest.fn(),
    extractFromRss: jest.fn(),
    generateExcerpt: jest.fn(),
    testConnection: jest.fn(),
  } as unknown as AiProvider;
}

function buildSchemaConformingResponse() {
  return JSON.stringify({
    works: [{ title: 'テスト作品', title_en: null, is_primary: true }],
    store: { name: 'テスト店舗', multiple_locations: null },
    メディアタイプ: 'anime',
    原作タイプ: 'manga_based',
    原作者有無: true,
    原作者名: ['テスト先生'],
    スタジオ名: null,
    監督名: null,
    シリーズ名: null,
    開催期間: {
      開始: { 年: '2026年', 日付: '5月1日' },
      終了: { 年: '2026年', 日付: '6月30日', 未定: false },
    },
    公式サイトURL: 'https://example.com',
    略称: null,
    キャラクター名: null,
    テーマ名: null,
    開催回数: '第2弾',
    ノベルティ名: null,
    ノベルティ種類数: null,
    メニュー種類数: null,
    グッズ名: null,
    メニュー詳細リスト: null,
    メニューテーマ説明: null,
    具体的なメニュー名リスト: null,
    店舗の住所: null,
    開催都道府県: null,
    コピーライト: null,
    TwitterURL: null,
    event_data: {
      primary_category_slug: 'collabo-cafe',
      title_slugs: ['test-work'],
      supplementary_category_slugs: [],
      occurrences: [
        {
          venue_slug: null,
          venue_label: 'テスト店舗',
          starts_on: '2026-05-01',
          ends_on: '2026-06-30',
          official_url: 'https://example.com/event',
        },
      ],
    },
    _reasoning: {
      works: 'test',
      work_vs_store: 'test',
      store: 'test',
      開催期間: 'test',
      メディアタイプ: 'test',
      原作タイプ: 'test',
      原作者名: 'test',
      スタジオ名: null,
      監督名: null,
      シリーズ名: null,
      開催都道府県: 'test',
      メニュー詳細リスト: null,
      メニューテーマ説明: null,
      具体的なメニュー名リスト: null,
      event_data_reason: 'test',
    },
  });
}

describe('ExtractionService.parseResponse — Layer 2 safeParse contract (Sprint C-β P0)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('preserves 開催回数 field through validated safeParse path (Sprint C-β P0 F1)', async () => {
    const service = new ExtractionService(stubTemplateLoader(), stubAiProvider(buildSchemaConformingResponse()));
    const result = await service.extractFromOfficialSite({
      primary_official_url: 'https://example.com',
      page_content: 'stub',
    });

    expect(result.開催回数).toBe('第2弾');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('validated path carries event_data object through unchanged (Sprint C-β P0 main goal)', async () => {
    const service = new ExtractionService(stubTemplateLoader(), stubAiProvider(buildSchemaConformingResponse()));
    const result = await service.extractFromOfficialSite({
      primary_official_url: 'https://example.com',
      page_content: 'stub',
    });

    expect(result.event_data).toEqual(
      expect.objectContaining({
        primary_category_slug: 'collabo-cafe',
        title_slugs: ['test-work'],
        occurrences: expect.arrayContaining([
          expect.objectContaining({
            starts_on: '2026-05-01',
            ends_on: '2026-06-30',
            official_url: 'https://example.com/event',
          }),
        ]),
      })
    );
  });

  it('falls back to lenient parse and logs warning when LLM emits invalid enum (Anthropic/Gemini path resilience)', async () => {
    const badResponse = JSON.stringify({
      ...JSON.parse(buildSchemaConformingResponse()),
      メディアタイプ: 'anime_series', // invalid — not in MediaTypeEnum
    });
    const service = new ExtractionService(stubTemplateLoader(), stubAiProvider(badResponse));

    const result = await service.extractFromOfficialSite({
      primary_official_url: 'https://example.com',
      page_content: 'stub',
    });

    // Lenient fallback returns the raw string, not narrowed to enum
    expect(result.メディアタイプ).toBe('anime_series');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ExtractionResponseSchema.safeParse failed'),
      expect.objectContaining({ issues: expect.any(Array) })
    );
  });

  it('derives 複数店舗情報 from store.multiple_locations when top-level field is stripped by safeParse (Sprint C-β P0 R2)', async () => {
    // On safeParse success, jsonData becomes parsed.data (z.object strips unknown top-level keys).
    // 複数店舗情報 is legacy (YAML SoT L919: subsumed by store.multiple_locations) and not declared
    // in ExtractionResponseSchema, so the fallback in parseResponse must derive it from store.
    const conforming = JSON.parse(buildSchemaConformingResponse());
    conforming.store.multiple_locations = '東京・大阪・名古屋の 3 店舗で開催';
    const service = new ExtractionService(stubTemplateLoader(), stubAiProvider(JSON.stringify(conforming)));

    const result = await service.extractFromOfficialSite({
      primary_official_url: 'https://example.com',
      page_content: 'stub',
    });

    expect(result.複数店舗情報).toBe('東京・大阪・名古屋の 3 店舗で開催');
    // safeParse should succeed (no warning) — confirms the strip-then-fallback path fires
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to lenient parse when LLM emits unschemed URL (F5 downstream safety net)', async () => {
    const conforming = JSON.parse(buildSchemaConformingResponse());
    conforming.event_data.occurrences[0].official_url = 'collabo-cafe.com/xxx'; // no scheme
    const service = new ExtractionService(stubTemplateLoader(), stubAiProvider(JSON.stringify(conforming)));

    await service.extractFromOfficialSite({
      primary_official_url: 'https://example.com',
      page_content: 'stub',
    });

    // safeParse rejects because official_url.url() constraint fails
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ExtractionResponseSchema.safeParse failed'),
      expect.any(Object)
    );
  });
});
