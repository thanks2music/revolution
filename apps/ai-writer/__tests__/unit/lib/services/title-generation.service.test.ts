import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import { TitleGenerationService } from '@/lib/services/title-generation.service';
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
