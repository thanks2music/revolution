import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { SubpageText } from '@/lib/services/category-image-extractor.service';
import {
  SubpageExtractionService,
  formatPagesForPrompt,
  parseSubpageResponse,
  toGoodsItems,
} from '@/lib/services/subpage-extraction.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

/**
 * 下層ページの抽出 (Layer 1: プロンプトへの並べ方と応答の読み方、Layer 2: AI は mock)。
 */

const PAGES: SubpageText[] = [
  { url: 'https://example.com/menu', kind: 'menu', text: '<h2>PIZZA</h2><p>マルゲリータ 2,090円(税込)</p>' },
  { url: 'https://example.com/s004', kind: 'venue', text: '<h1>TOKYO INFORMATION</h1><p>ホログラムステッカー</p>' },
];

describe('formatPagesForPrompt', () => {
  it('ページごとに URL・種類・本文を並べる', () => {
    const text = formatPagesForPrompt(PAGES);

    expect(text).toContain('### ページ 1\n- URL: https://example.com/menu\n- 種類: menu');
    expect(text).toContain('### ページ 2\n- URL: https://example.com/s004\n- 種類: venue');
    expect(text).toContain('ホログラムステッカー');
  });

  it('全体を予算に収める (先のページから使い、足りないページは切り詰める)', () => {
    const long: SubpageText[] = [
      { url: 'https://example.com/a', kind: 'menu', text: 'あ'.repeat(80) },
      { url: 'https://example.com/b', kind: 'goods', text: 'い'.repeat(80) },
    ];

    const text = formatPagesForPrompt(long, 100);

    expect(text).toContain('あ'.repeat(80));
    expect(text).toContain('い'.repeat(20) + '\n(以下省略)');
    expect(text).not.toContain('い'.repeat(21));
  });
});

describe('parseSubpageResponse', () => {
  it('URL で入力のページに対応づけ、値の無いものは null にする', () => {
    const facts = parseSubpageResponse(
      {
        pages: [
          {
            url: 'https://example.com/s004',
            area: '東京',
            ノベルティ名: ['ホログラムステッカー', ''],
            グッズ詳細リスト: 'null',
          },
          {
            url: 'https://example.com/menu',
            area: '東京', // venue 以外の area は使わない
            メニュー詳細リスト: [{ character: 'null', name: 'マルゲリータ', price: '2,090円(税込)' }, { name: '' }],
          },
        ],
      },
      PAGES
    );

    expect(facts[0]).toEqual({
      url: 'https://example.com/menu',
      kind: 'menu',
      area: null,
      メニュー詳細リスト: [{ character: null, name: 'マルゲリータ', price: '2,090円(税込)', imageUrl: null, copyright: null }],
      グッズ詳細リスト: null,
      ノベルティ名: null,
      キャラクター名: null,
    });
    expect(facts[1]).toMatchObject({ kind: 'venue', area: '東京', ノベルティ名: ['ホログラムステッカー'], グッズ詳細リスト: null });
  });

  it('URL が無ければ順番で対応づけ、応答に無いページは何も読めなかったものとする', () => {
    const facts = parseSubpageResponse({ pages: [{ グッズ詳細リスト: [{ name: '缶バッジ' }] }] }, PAGES);

    expect(facts.map((f) => f.グッズ詳細リスト?.map((g) => g.name) ?? null)).toEqual([['缶バッジ'], null]);
  });

  it('応答の形が崩れていても例外にせず、全ページを空にする', () => {
    expect(parseSubpageResponse('broken', PAGES).every((f) => f.メニュー詳細リスト === null)).toBe(true);
  });
});

describe('toGoodsItems', () => {
  it('品名・価格・販売方法を読み、販売方法は決まった値だけを受け付ける', () => {
    expect(
      toGoodsItems([
        { name: '缶バッジ レトロver.（ランダム12種）', price: '605円(税込)', sales: 'store_and_online' },
        { name: 'コンプリートセット', price: 'null', sales: 'online_only' },
        { name: 'サイダー', sales: '店舗限定' }, // 決まった値でなければ null
        { name: '', price: '100円' },
      ])
    ).toEqual([
      { name: '缶バッジ レトロver.（ランダム12種）', price: '605円(税込)', sales: 'store_and_online' },
      { name: 'コンプリートセット', price: null, sales: 'online_only' },
      { name: 'サイダー', price: null, sales: null },
    ]);
  });
});

describe('SubpageExtractionService.extract', () => {
  const TEMPLATE = { prompts: { extract_subpages: '作品名: {{作品名}}\n\n## ページ\n\n{{pages}}' } };

  function build(content: string) {
    const sendMessage = jest.fn(async () => ({ content, model: 'test-model', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }));
    const loader = { loadModularTemplate: jest.fn(async () => TEMPLATE) } as unknown as YamlTemplateLoaderService;
    const service = new SubpageExtractionService(loader, { sendMessage } as unknown as AiProvider);
    return { service, sendMessage, loader };
  }

  it('YAML のプロンプトに作品名とページを差し込み、応答をページごとに返す', async () => {
    const { service, sendMessage } = build(
      '```json\n{"pages":[{"url":"https://example.com/menu","メニュー詳細リスト":[{"character":null,"name":"マルゲリータ","price":null}]}]}\n```'
    );

    const result = await service.extract({ 作品名: '僕のヒーローアカデミア', pages: PAGES });

    const [prompt, options] = sendMessage.mock.calls[0] as unknown as [string, { stepId: string; responseSchema: unknown }];
    expect(prompt).toContain('作品名: 僕のヒーローアカデミア');
    expect(prompt).toContain('- URL: https://example.com/s004');
    expect(options.stepId).toBe('subpage-extraction');
    expect(options.responseSchema).toBeDefined();
    expect(result?.pages[0].メニュー詳細リスト?.[0].name).toBe('マルゲリータ');
    expect(result?.model).toBe('test-model');
  });

  it('ページが無ければ LLM を呼ばない', async () => {
    const { service, sendMessage } = build('{}');

    expect(await service.extract({ 作品名: null, pages: [] })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
