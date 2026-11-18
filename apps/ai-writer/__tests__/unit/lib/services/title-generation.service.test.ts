import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { TitleGenerationError, TitleGenerationService } from '@/lib/services/title-generation.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

/**
 * タイトル生成のうち、開催都市の確定値の扱いを固定する (Layer 2、AI は mock)。
 *
 * 2026-10-10 heroaca-cafe: 確定値 `4都市` を渡しても、プロンプトに常に入っていた
 * 「本文から都市を抜き出して / で並べる」節に従い、LLM が `東京/大阪/名古屋/宮城` と書いた。
 */

const MULTI_LOCATION_SECTION = '複数店舗開催時のロケーション抽出ルール';

const TEMPLATE = {
  prompts: { generate_title: 'タイトルを生成する' },
  logic: { multi_location_extraction: MULTI_LOCATION_SECTION },
  rules: [],
  constraints: {},
};

const REQUEST = { rss_title: 'ヒロアカカフェ', rss_content: '本文', rss_link: 'https://example.com/' };

function setup(responseTitle: string) {
  const sendMessage = jest.fn(async (_prompt: string) => ({
    content: JSON.stringify({ title: responseTitle }),
    model: 'test-model',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  }));
  const loader = { loadModularTemplate: async () => TEMPLATE } as unknown as YamlTemplateLoaderService;
  const service = new TitleGenerationService(loader, { sendMessage } as unknown as AiProvider);
  return { service, sentPrompt: () => sendMessage.mock.calls[0][0] };
}

describe('TitleGenerationService の開催都市', () => {
  it('確定値を渡すときは、都市を抽出させる節をプロンプトに入れない', async () => {
    const { service, sentPrompt } = setup('ヒロアカ カフェ in 4都市 10月16日よりコラボ開催');
    await service.generateTitle({ ...REQUEST, extractedCityLabel: '4都市' });

    expect(sentPrompt()).not.toContain(MULTI_LOCATION_SECTION);
  });

  it('確定値が無いときは、都市を抽出させる節をプロンプトに入れる', async () => {
    const { service, sentPrompt } = setup('ヒロアカ カフェ in 東京/大阪 10月16日よりコラボ開催');
    await service.generateTitle(REQUEST);

    expect(sentPrompt()).toContain(MULTI_LOCATION_SECTION);
  });

  it('LLM が都市を推測で並べても、確定値へ置き換えて返す', async () => {
    const { service } = setup('ヒロアカ カフェ in 東京/大阪/名古屋/宮城 10月16日よりコラボ開催');
    const result = await service.generateTitle({ ...REQUEST, extractedCityLabel: '4都市' });

    expect(result.title).toBe('ヒロアカ カフェ in 4都市 10月16日よりコラボ開催');
  });
});

/**
 * 応答の形と文字数の扱い (2026-11-18)。
 *
 * Gemini が `[ { "title": ... } ]` と配列で返し、以前の「応答の最初の行をタイトルにする」処理で
 * タイトルが「[」になった。文字数を外れても警告だけで記事に使っていたので、PR まで進んだ。
 */
describe('TitleGenerationService の応答の検証と作り直し', () => {
  const VALID = 'BANANA FISH カフェ&バー in 新宿 11月26日よりコラボ開催'; // 38 字
  const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

  function setupSequence(contents: string[]) {
    const sendMessage = jest.fn(async (_prompt: string, _options?: unknown) => ({
      content: contents[Math.min(sendMessage.mock.calls.length - 1, contents.length - 1)],
      model: 'test-model',
      usage: USAGE,
    }));
    const loader = { loadModularTemplate: async () => TEMPLATE } as unknown as YamlTemplateLoaderService;
    const service = new TitleGenerationService(loader, { sendMessage } as unknown as AiProvider);
    return { service, sendMessage };
  }

  const json = (title: string) => JSON.stringify({ title, _reasoning: '理由' });

  it('応答の形 (title と _reasoning) を schema として provider に渡す', async () => {
    const { service, sendMessage } = setupSequence([json(VALID)]);
    await service.generateTitle(REQUEST);

    const options = sendMessage.mock.calls[0][1] as { responseSchema?: { schema: { required?: string[] } } };
    expect(options.responseSchema?.schema.required).toEqual(['title', '_reasoning']);
  });

  it('配列で包んだ応答は読まずに作り直し、2 回目のタイトルを使う', async () => {
    const { service, sendMessage } = setupSequence([`[\n${json(VALID)}\n]`, json(VALID)]);
    const result = await service.generateTitle(REQUEST);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ title: VALID, is_valid: true });
    // 作り直した回の費用も含める
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });

  it('2 回とも読めなければ、応答の 1 行目をタイトルにせず TitleGenerationError を投げる', async () => {
    const { service, sendMessage } = setupSequence(['[\n{"title": 1}\n]', 'これはJSONではない']);
    const error = await service.generateTitle(REQUEST).catch((e: unknown) => e);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(TitleGenerationError);
    expect((error as TitleGenerationError).usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect((error as TitleGenerationError).model).toBe('test-model');
  });

  it('文字数が足りなければ作り直し、満たしたタイトルを使う', async () => {
    const { service, sendMessage } = setupSequence([json('BANANA FISH カフェ'), json(VALID)]);
    const result = await service.generateTitle(REQUEST);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(VALID);
  });

  it('2 回とも 40 字を超えれば TitleGenerationError を投げる (警告だけで記事に使わない)', async () => {
    const tooLong = 'BANANA FISH カフェ&バー in 新宿 東口 11月26日よりコラボカフェ開催決定'; // 46 字
    const { service } = setupSequence([json(tooLong)]);

    await expect(service.generateTitle(REQUEST)).rejects.toThrow(/28〜40文字/);
  });

  it('_reasoning が無い応答も読む (schema を使わない provider がある)', async () => {
    const { service } = setupSequence([JSON.stringify({ title: VALID })]);
    const result = await service.generateTitle(REQUEST);

    expect(result).toMatchObject({ title: VALID, _reasoning: undefined });
  });
});
