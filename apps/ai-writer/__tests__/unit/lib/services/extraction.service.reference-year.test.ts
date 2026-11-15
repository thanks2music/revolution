/**
 * Layer 2: the reference year (`reference_year`) of extraction. It is shown to the LLM as the input
 * field 「基準年」 (2-extraction.yaml gives it to dates written without a year) and fills a missing
 * start year in the response. Past events pass their own year; others get the current year.
 */
import type { AiProvider, SendMessageOptions, SendMessageResult } from '@/lib/ai/providers/ai-provider.interface';
import { ExtractionService } from '@/lib/services/extraction.service';
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

/** Captures prompts and answers with a start date that has no year */
function capturingProvider(): { provider: AiProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider = {
    sendMessage: jest.fn(async (prompt: string, _options?: SendMessageOptions): Promise<SendMessageResult> => {
      prompts.push(prompt);
      return {
        content: JSON.stringify({
          works: [{ title: 'テスト作品', title_en: null, is_primary: true }],
          store: { name: 'テスト店舗', multiple_locations: null },
          開催期間: { 開始: { 日付: '5月1日' }, 終了: { 年: null, 日付: '6月30日', 未定: false } },
          公式サイトURL: 'https://example.com',
        }),
        model: 'test-model',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }),
    generateArticle: jest.fn(),
    generateSlug: jest.fn(),
    extractFromRss: jest.fn(),
    generateExcerpt: jest.fn(),
    testConnection: jest.fn(),
  } as unknown as AiProvider;
  return { provider, prompts };
}

async function extract(referenceYear?: number) {
  const { provider, prompts } = capturingProvider();
  const service = new ExtractionService(stubTemplateLoader(), provider);
  const result = await service.extractFromOfficialSite({
    primary_official_url: 'https://example.com/',
    page_content: '<p>本文</p>',
    reference_year: referenceYear,
  });
  return { prompt: prompts[0], result };
}

describe('ExtractionService の基準年 (Layer 2)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the given year in the input data and uses it for a start date without a year', async () => {
    const { prompt, result } = await extract(2019);
    expect(prompt).toContain('- 基準年: 2019年\n');
    expect(result.開催期間.開始.年).toBe('2019年');
  });

  it('uses the current year when no year is given', async () => {
    const year = new Date().getFullYear();
    const { prompt, result } = await extract();
    expect(prompt).toContain(`- 基準年: ${year}年\n`);
    expect(result.開催期間.開始.年).toBe(`${year}年`);
  });
});
