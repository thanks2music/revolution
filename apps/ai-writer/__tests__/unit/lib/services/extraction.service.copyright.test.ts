/**
 * Layer 2: 公式サイトの著作権表記を、抽出のプロンプトの入力データの欄に置く (2-extraction.yaml 2.9.6 のルールがこの欄を指す)
 *
 * `buildPrompt` は private なので、`aiProvider` を DI したスタブで `sendMessage` に渡された prompt を捕まえて検査する
 * (`extraction.service.truncation.test.ts` と同じパターン)
 */
import type {
  AiProvider,
  SendMessageOptions,
  SendMessageResult,
} from '@/lib/ai/providers/ai-provider.interface';
import { ExtractionService } from '@/lib/services/extraction.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

function stubTemplateLoader(authorExtraction: string): YamlTemplateLoaderService {
  return {
    loadModularTemplate: jest.fn().mockResolvedValue({
      metadata: { name: 'test' },
      prompts: { extraction: 'test prompt' },
      logic: { author_extraction: authorExtraction },
      derived_variables: {},
      section_selection: {},
      section_dependencies: {},
      sections: {},
    }),
  } as unknown as YamlTemplateLoaderService;
}

/** `sendMessage` に渡された prompt を捕まえるスタブ。 */
function capturingProvider(): { provider: AiProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider = {
    sendMessage: jest.fn(
      async (prompt: string, _options?: SendMessageOptions): Promise<SendMessageResult> => {
        prompts.push(prompt);
        // parseResponse が必須フィールド (works[].title with is_primary) を要求するため、
        // 通る最小限の応答を返す。本テストの関心は prompt 側なので中身は問わない。
        return {
          content: JSON.stringify({
            works: [{ title: 'テスト作品', title_en: null, is_primary: true }],
            store: { name: 'テスト店舗', multiple_locations: null },
            開催期間: {
              開始: { 年: '2026年', 日付: '5月1日' },
              終了: { 年: '2026年', 日付: '6月30日', 未定: false },
            },
            公式サイトURL: 'https://example.com',
          }),
          model: 'test-model',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
    ),
    generateArticle: jest.fn(),
    generateSlug: jest.fn(),
    extractFromRss: jest.fn(),
    generateExcerpt: jest.fn(),
    testConnection: jest.fn(),
  } as unknown as AiProvider;

  return { provider, prompts };
}

async function promptFor(authorExtraction: string, notices?: string[]): Promise<string> {
  const { provider, prompts } = capturingProvider();
  const service = new ExtractionService(stubTemplateLoader(authorExtraction), provider);
  await service.extractFromOfficialSite({
    primary_official_url: 'https://example.com/',
    page_content: '<p>本文</p>',
    copyright_notices: notices,
  });
  return prompts[0];
}

describe('ExtractionService の著作権表記の差し込み (Layer 2)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('著作権表記を入力データの欄に並べる (ページコンテンツの前)', async () => {
    const prompt = await promptFor('rule', ['©堀越耕平／集英社', '©青山剛昌／小学館']);
    expect(prompt).toContain('- 公式サイトの著作権表記: ©堀越耕平／集英社 / ©青山剛昌／小学館\n- ページコンテンツ:');
  });

  it('著作権表記が無ければ「なし」と書く', async () => {
    expect(await promptFor('rule', [])).toContain('- 公式サイトの著作権表記: なし\n');
    expect(await promptFor('rule')).toContain('- 公式サイトの著作権表記: なし\n');
  });
});
