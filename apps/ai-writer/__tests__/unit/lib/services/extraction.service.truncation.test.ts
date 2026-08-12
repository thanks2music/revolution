/**
 * Layer 2: `ExtractionService` が**実際に**予算どおり切り詰めることを固定する。
 *
 * ## なぜ定数のテストだけでは足りないか
 *
 * `compact-html.test.ts` は `LLM_INPUT_BUDGET_CHARS` の**導出**(窓に収まるか、
 * 比率、drift guard) を検証するが、**消費側のコードは 1 行も通らない**。
 *
 * 本 PR 群の出発点は「`substring(0, 15000)` による切り詰めが 7 ヶ月間気づかれず、
 * `conan-cafe.jp` の会場一覧が静かに失われていた」ことである。定数だけを固定しても、
 * 呼び出し側で off-by-one が入ったり、誰かが定数の代わりにリテラルを書き戻したりすれば
 * 同じ事故が再発する。**境界そのものを消費側で固定する。**
 *
 * ## 検証の入口
 *
 * `buildPrompt` は private なので、`aiProvider` を DI したスタブで
 * `sendMessage` に渡された prompt を捕まえて検査する
 * (`extraction.service.parseResponse.test.ts` と同じパターン)。
 */

import type {
  AiProvider,
  SendMessageOptions,
  SendMessageResult,
} from '@/lib/ai/providers/ai-provider.interface';
import { ExtractionService } from '@/lib/services/extraction.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';
import { LLM_INPUT_BUDGET_CHARS } from '@/lib/utils/compact-html';

const TRUNCATION_MARKER = '\n...(truncated)';

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

/** 指定文字数の本文でプロンプトを 1 回作り、その中身を返す。 */
async function promptFor(pageContent: string): Promise<string> {
  const { provider, prompts } = capturingProvider();
  const service = new ExtractionService(stubTemplateLoader(), provider);

  await service.extractFromOfficialSite({
    primary_official_url: 'https://example.com/',
    page_content: pageContent,
  });

  expect(prompts).toHaveLength(1);
  return prompts[0];
}

/** プロンプトからページ本文の部分だけを取り出す。 */
function pageContentOf(prompt: string): string {
  const key = '- ページコンテンツ:';
  const start = prompt.lastIndexOf(key) + key.length;
  const end = prompt.lastIndexOf('上記のページコンテンツを解析し');
  return prompt
    .slice(start, end)
    .replace(/^\s+/, '')
    .replace(/\s*---\s*$/, '')
    .replace(/\n\.\.\.\(truncated\)$/, '');
}

describe('ExtractionService の切り詰め境界 (Layer 2)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('予算未満の本文は切り詰めず、マーカーも付かない', async () => {
    const content = 'あ'.repeat(LLM_INPUT_BUDGET_CHARS - 1);
    const prompt = await promptFor(content);

    expect(prompt).not.toContain(TRUNCATION_MARKER);
    expect(pageContentOf(prompt)).toBe(content);
  });

  it('予算とちょうど同じ長さでも切り詰めず、マーカーも付かない (off-by-one 検知)', async () => {
    const content = 'あ'.repeat(LLM_INPUT_BUDGET_CHARS);
    const prompt = await promptFor(content);

    expect(prompt).not.toContain(TRUNCATION_MARKER);
    expect(pageContentOf(prompt)).toHaveLength(LLM_INPUT_BUDGET_CHARS);
  });

  it('予算を 1 文字超えたら切り詰め、マーカーが付く', async () => {
    const content = 'あ'.repeat(LLM_INPUT_BUDGET_CHARS + 1);
    const prompt = await promptFor(content);

    expect(prompt).toContain(TRUNCATION_MARKER);
    expect(pageContentOf(prompt)).toHaveLength(LLM_INPUT_BUDGET_CHARS);
  });

  it('★ 予算より後方にある情報は LLM へ届かない (本 PR 群の出発点そのもの)', async () => {
    // conan-cafe.jp で実際に起きたこと: 会場一覧がページ後方にあり窓に入らなかった。
    // 「届かない」ことを明示的に固定しておく (直ったつもりで境界を壊さないため)。
    const filler = 'あ'.repeat(LLM_INPUT_BUDGET_CHARS);
    const prompt = await promptFor(`${filler}BOX cafe&space GEMS渋谷店`);

    expect(prompt).toContain(TRUNCATION_MARKER);
    expect(prompt).not.toContain('GEMS渋谷店');
  });

  it('予算内にある情報は届く', async () => {
    const prompt = await promptFor('BOX cafe&space GEMS渋谷店 2026年4月10日〜6月28日');

    expect(prompt).toContain('BOX cafe&space GEMS渋谷店');
    expect(prompt).toContain('2026年4月10日');
  });

  it('サロゲートペアを割らない — 切断点に絵文字が来ても不正な文字を残さない', async () => {
    // `compactHtmlForLlm` は img を `[画像: <alt>]` へ畳むため、alt の絵文字が
    // 本文へ入りうる。素の substring だと対を欠いた上位サロゲートが末尾に残る。
    const emoji = '🎉'; // U+1F389 = サロゲートペア (length 2)
    // 予算の直前で 1 コードユニット余らせ、境界がペアの内側に落ちるようにする
    const content = 'あ'.repeat(LLM_INPUT_BUDGET_CHARS - 1) + emoji + 'あ';
    const prompt = await promptFor(content);
    const body = pageContentOf(prompt);

    expect(prompt).toContain(TRUNCATION_MARKER);
    // 末尾が孤立した上位サロゲートになっていないこと
    const lastCode = body.charCodeAt(body.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
    // 1 コードユニット戻した結果、予算より 1 短くなる
    expect(body).toHaveLength(LLM_INPUT_BUDGET_CHARS - 1);
    // 割れた絵文字が混入していないこと
    expect(body).not.toContain(emoji.charAt(0));
  });

  it('リテラルではなく定数を参照している — 予算を変えると境界も動く', async () => {
    // 呼び出し側にリテラルが書き戻されると、この 2 つの長さが一致しなくなる。
    const prompt = await promptFor('あ'.repeat(LLM_INPUT_BUDGET_CHARS + 100));

    expect(pageContentOf(prompt)).toHaveLength(LLM_INPUT_BUDGET_CHARS);
  });
});
