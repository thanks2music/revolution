import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import type { SubpageText } from '@/lib/services/category-image-extractor.service';
import {
  SubpageExtractionService,
  batchPages,
  formatPagesForPrompt,
  parseSubpageResponse,
  sumUsage,
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

describe('batchPages', () => {
  const pageOf = (url: string, size: number): SubpageText => ({ url, kind: 'venue', text: 'あ'.repeat(size) });

  it('本文の合計が予算に収まるまとまりに、順番を保って分ける', () => {
    const pages = [pageOf('a', 40), pageOf('b', 50), pageOf('c', 30), pageOf('d', 90)];

    expect(batchPages(pages, 100).map((batch) => batch.map((p) => p.url))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('1 ページで予算を超えるものは、そのページだけのまとまりにする', () => {
    expect(batchPages([pageOf('big', 500), pageOf('small', 10)], 100).map((b) => b.map((p) => p.url))).toEqual([
      ['big'],
      ['small'],
    ]);
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

  it('URL は末尾の / の違いを無視して対応づける。URL が無くても、ページ数が同じなら順番で対応づける', () => {
    const facts = parseSubpageResponse(
      { pages: [{ url: 'https://example.com/menu/', グッズ詳細リスト: [{ name: '缶バッジ' }] }, { ノベルティ名: ['ステッカー'] }] },
      PAGES
    );

    expect(facts[0].グッズ詳細リスト?.[0].name).toBe('缶バッジ');
    expect(facts[1].ノベルティ名).toEqual(['ステッカー']);
  });

  it('ページを飛ばした応答では、順番で別のページの事実を写さない', () => {
    const facts = parseSubpageResponse({ pages: [{ ノベルティ名: ['ステッカー'] }] }, PAGES);

    expect(facts.map((f) => f.ノベルティ名)).toEqual([null, null]);
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

  it('予算を超えるページは分けて呼び、結果を入力の順にまとめて、使用量を合計する', async () => {
    const big = (url: string): SubpageText => ({ url, kind: 'venue', text: 'あ'.repeat(40_000) });
    const sendMessage = jest.fn(async (prompt: string) => {
      const url = /- URL: (\S+)/.exec(prompt)![1];
      return {
        content: JSON.stringify({ pages: [{ url, area: '東京', ノベルティ名: [url] }] }),
        model: 'test-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });
    const loader = { loadModularTemplate: jest.fn(async () => TEMPLATE) } as unknown as YamlTemplateLoaderService;
    const service = new SubpageExtractionService(loader, { sendMessage } as unknown as AiProvider);

    const result = await service.extract({ 作品名: null, pages: [big('https://example.com/a'), big('https://example.com/b')] });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result?.pages.map((p) => p.ノベルティ名)).toEqual([['https://example.com/a'], ['https://example.com/b']]);
    expect(result?.usage).toMatchObject({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });

  it('一部のまとまりが失敗しても、他のまとまりの結果は使う (失敗したページは何も読めなかったものとする)', async () => {
    const big = (url: string): SubpageText => ({ url, kind: 'venue', text: 'あ'.repeat(40_000) });
    const sendMessage = jest.fn(async (prompt: string) => {
      const url = /- URL: (\S+)/.exec(prompt)![1];
      if (url.endsWith('/b')) throw new Error('MAX_TOKENS');
      return { content: JSON.stringify({ pages: [{ url, ノベルティ名: ['ステッカー'] }] }), model: 'm', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    });
    const loader = { loadModularTemplate: jest.fn(async () => TEMPLATE) } as unknown as YamlTemplateLoaderService;
    const service = new SubpageExtractionService(loader, { sendMessage } as unknown as AiProvider);

    const result = await service.extract({ 作品名: null, pages: [big('https://example.com/a'), big('https://example.com/b')] });

    expect(result?.pages.map((p) => [p.url, p.ノベルティ名])).toEqual([
      ['https://example.com/a', ['ステッカー']],
      ['https://example.com/b', null],
    ]);
  });

  it('作品名に {{pages}} の文字列があってもページを展開せず、本文に ``` を含む JSON もそのまま読む', async () => {
    const { service, sendMessage } = build(
      JSON.stringify({ pages: [{ url: 'https://example.com/menu', ノベルティ名: ['```ステッカー```'] }] })
    );

    const result = await service.extract({ 作品名: 'A{{pages}}B', pages: PAGES });

    const [prompt] = sendMessage.mock.calls[0] as unknown as [string];
    expect(prompt).toContain('作品名: A{{pages}}B');
    expect(prompt.match(/### ページ 1/g)).toHaveLength(1);
    expect(result?.pages[0].ノベルティ名).toEqual(['```ステッカー```']);
  });

  it('ページが無ければ LLM を呼ばない', async () => {
    const { service, sendMessage } = build('{}');

    expect(await service.extract({ 作品名: null, pages: [] })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('sumUsage', () => {
  it('キャッシュの項目は、どれかの呼び出しが報告したときだけ合計する', () => {
    const base = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

    expect(sumUsage([base, base])).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect(sumUsage([base, { ...base, cachedTokens: 4 }])).toEqual({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      cachedTokens: 4,
    });
    expect(sumUsage([undefined])).toBeUndefined();
  });
});
