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
  prompts: { generate_title: 'タイトルを生成する', ended_event_note: 'ENDED_NOTE:{{period}}\n' },
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
 * 記事を作った時点で終わっていたイベント (2026-11-27)。期間を入れた ended_event_note を足し、開始日を使う指示は入れない
 */
describe('TitleGenerationService の終わったイベント', () => {
  const PERIOD = {
    開始: { 年: '2023年', 日付: '8月4日' },
    終了: { 年: '2023年', 日付: '8月30日', 未定: false },
  } as unknown as NonNullable<Parameters<TitleGenerationService['generateTitle']>[0]['extractedPeriod']>;
  const TITLE = '作品A × 会場Aのコラボカフェ 2023年8月4日〜8月30日コラボ開催';

  it('期間を渡すと ended_event_note を入れ、開始日の指示を入れない', async () => {
    const { service, sentPrompt } = setup(TITLE);
    await service.generateTitle({ ...REQUEST, extractedPeriod: PERIOD, endedPeriod: '2023年8月4日〜8月30日' });

    expect(sentPrompt()).toContain('ENDED_NOTE:2023年8月4日〜8月30日');
    expect(sentPrompt()).not.toContain('タイトルの開始日は');
  });

  it('期間を渡さなければ ended_event_note を入れず、開始日の指示を入れる', async () => {
    const { service, sentPrompt } = setup(TITLE);
    await service.generateTitle({ ...REQUEST, extractedPeriod: PERIOD });

    expect(sentPrompt()).not.toContain('ENDED_NOTE');
    expect(sentPrompt()).toContain('タイトルの開始日は');
  });

  it('ended_event_note が templates に無ければ止める', async () => {
    const sendMessage = jest.fn();
    const loader = {
      loadModularTemplate: async () => ({ ...TEMPLATE, prompts: { generate_title: 'タイトルを生成する' } }),
    } as unknown as YamlTemplateLoaderService;
    const service = new TitleGenerationService(loader, { sendMessage } as unknown as AiProvider);

    await expect(service.generateTitle({ ...REQUEST, endedPeriod: '2023年8月4日〜8月30日' })).rejects.toThrow(/ended_event_note/);
    expect(sendMessage).not.toHaveBeenCalled();
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

    const options = sendMessage.mock.calls[0][1] as {
      responseSchema?: { schema: { required?: string[]; additionalProperties?: boolean } };
    };
    expect(options.responseSchema?.schema.required).toEqual(['title', '_reasoning']);
    // OpenAI の Structured Outputs (strict) は additionalProperties: false を要求する
    expect(options.responseSchema?.schema.additionalProperties).toBe(false);
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
    const { service, sendMessage } = setupSequence([json(tooLong)]);

    await expect(service.generateTitle(REQUEST)).rejects.toThrow(/28〜40文字/);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('終わったイベントは 40 字を超えてもそのまま使う (上限を設けない。2026-11-27)', async () => {
    const longEnded = 'くまのプーさん カフェ in 2都市 2026年8月20日〜10月25日コラボ開催'; // 41 字
    const { service, sendMessage } = setupSequence([json(longEnded)]);
    const result = await service.generateTitle({ ...REQUEST, endedPeriod: '2026年8月20日〜10月25日' });

    expect(result.title).toBe(longEnded);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('終わったイベントは、都市を確定値へ置き換えて 40 字を超えても N都市に丸めない', async () => {
    const { service } = setupSequence([json('くまのプーさん カフェ in 東京/名古屋 2026年8月20日〜10月25日コラボ開催')]);
    const result = await service.generateTitle({
      ...REQUEST,
      endedPeriod: '2026年8月20日〜10月25日',
      extractedCityLabel: '東京/大阪',
    });

    expect(result.title).toBe('くまのプーさん カフェ in 東京/大阪 2026年8月20日〜10月25日コラボ開催');
  });

  it('終わったイベントでも 28 字に足りなければ作り直し、だめなら下限だけを挙げて投げる', async () => {
    const { service, sendMessage } = setupSequence([json('BANANA FISH カフェ')]);

    await expect(
      service.generateTitle({ ...REQUEST, endedPeriod: '2026年8月20日〜10月25日' }),
    ).rejects.toThrow(/28文字以上/);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('作り直しの呼び出しで provider が失敗しても、1 回目の費用を TitleGenerationError で返す', async () => {
    const sendMessage = jest
      .fn(async (_prompt: string, _options?: unknown) => ({
        content: json('BANANA FISH カフェ'),
        model: 'test-model',
        usage: USAGE,
      }))
      .mockImplementationOnce(async () => ({ content: '[', model: 'test-model', usage: USAGE }))
      .mockImplementationOnce(async () => {
        throw new Error('503 Service Unavailable');
      });
    const loader = { loadModularTemplate: async () => TEMPLATE } as unknown as YamlTemplateLoaderService;
    const service = new TitleGenerationService(loader, { sendMessage } as unknown as AiProvider);
    const error = await service.generateTitle(REQUEST).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TitleGenerationError);
    expect((error as TitleGenerationError).message).toMatch(/503/);
    expect((error as TitleGenerationError).cause).toBeInstanceOf(Error);
    expect((error as TitleGenerationError).usage).toEqual(USAGE);
    expect((error as TitleGenerationError).model).toBe('test-model');
  });

  it('空白だけのタイトルは読めないものとして作り直す', async () => {
    const { service, sendMessage } = setupSequence([json('   '), json(VALID)]);
    const result = await service.generateTitle(REQUEST);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(VALID);
  });

  it('_reasoning が無い応答も読む (schema を使わない provider がある)', async () => {
    const { service } = setupSequence([JSON.stringify({ title: VALID })]);
    const result = await service.generateTitle(REQUEST);

    expect(result).toMatchObject({ title: VALID, _reasoning: undefined });
  });
});
