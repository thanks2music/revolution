import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import {
  ArticlePointsGenerationService,
  ArticlePointsParseError,
  parseArticlePointsResponse,
  summarizeExtraction,
} from '@/lib/services/article-points-generation.service';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

/**
 * 「本イベントの特徴」(Layer 1: 応答の読み方と抽出結果の要約、Layer 2: AI は mock)。
 */

const EXTRACTION = {
  作品名: '僕のヒーローアカデミア',
  テーマ名: 'ヒーロー事務所',
  キャラクター名: ['緑谷出久', '爆豪勝己'],
  メニュー詳細リスト: [
    { character: '緑谷出久', name: 'デクのカツ丼', price: '1,890円', imageUrl: null, copyright: null },
    { character: null, name: 'ヒーローズパフェ', price: null, imageUrl: null, copyright: null },
  ],
  具体的なメニュー名リスト: null,
  グッズ名: ['アクリルスタンド'],
  ノベルティ名: ['コースター'],
} as unknown as ExtractionResult;

const TEMPLATE = {
  prompts: { write_features: '作品={{作品名}}\n事実=\n{{facts}}\n抽出={{extraction}}\n<pages>{{pages}}</pages>' },
};

function build(content: string | Error) {
  const sendMessage = jest.fn(async () => {
    if (content instanceof Error) throw content;
    return { content, model: 'test-model', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  });
  const loader = { loadModularTemplate: jest.fn(async () => TEMPLATE) } as unknown as YamlTemplateLoaderService;
  const service = new ArticlePointsGenerationService(loader, { sendMessage } as unknown as AiProvider);
  return { service, sendMessage };
}

describe('summarizeExtraction', () => {
  it('特徴の材料になる名前だけを渡す (メニューはキャラクター名を添える。ノベルティは渡さない)', () => {
    expect(summarizeExtraction(EXTRACTION)).toEqual({
      テーマ名: 'ヒーロー事務所',
      キャラクター名: ['緑谷出久', '爆豪勝己'],
      メニュー: ['デクのカツ丼 (緑谷出久)', 'ヒーローズパフェ'],
      グッズ名: ['アクリルスタンド'],
    });
  });
});

describe('parseArticlePointsResponse', () => {
  it('JSON を読み、空の項目は捨てる', () => {
    expect(parseArticlePointsResponse('{"features": ["A", " ", "B"]}')).toEqual(['A', 'B']);
  });

  it('コードブロックや前後の説明が付いていても読む', () => {
    expect(parseArticlePointsResponse('結果:\n```json\n{"features": ["A"]}\n```')).toEqual(['A']);
  });

  it('形が違えば例外 (呼び出し側が事実の行だけで続ける)', () => {
    expect(() => parseArticlePointsResponse('{"points": ["A"]}')).toThrow();
    expect(() => parseArticlePointsResponse('JSON ではない')).toThrow();
  });
});

describe('ArticlePointsGenerationService', () => {
  it('事実の行・抽出結果・ページをプロンプトに入れ、特徴とコストの材料を返す', async () => {
    const { service, sendMessage } = build('{"features": ["店内に装飾がある"]}');

    const result = await service.generate({
      作品名: '僕のヒーローアカデミア',
      factLines: ['2026年10月16日〜12月20日、東京・大阪の2会場', 'コラボメニュー全19品'],
      extraction: EXTRACTION,
      pages: [{ url: 'https://example.com/', kind: 'top', text: '<p>描き下ろし</p>' }],
    });

    expect(result).toEqual({
      features: ['店内に装飾がある'],
      model: 'test-model',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const [prompt, options] = sendMessage.mock.calls[0] as unknown as [string, { stepId: string; responseFormat: string }];
    expect(prompt).toContain('作品=僕のヒーローアカデミア');
    expect(prompt).toContain('- 2026年10月16日〜12月20日、東京・大阪の2会場\n- コラボメニュー全19品');
    expect(prompt).toContain('"テーマ名": "ヒーロー事務所"');
    expect(prompt).toContain('- URL: https://example.com/\n- 種類: top');
    expect(options).toMatchObject({ stepId: 'article-points', responseFormat: 'json' });
  });

  it('作品名に {{pages}} が含まれていても、そこへページを展開しない', async () => {
    const { service, sendMessage } = build('{"features": []}');

    await service.generate({ 作品名: '{{pages}}', factLines: [], extraction: EXTRACTION, pages: [] });

    const [prompt] = sendMessage.mock.calls[0] as unknown as [string];
    expect(prompt).toContain('作品={{pages}}');
    expect(prompt).toContain('事実=\n(なし)');
    expect(prompt).toContain('<pages>(なし)</pages>');
  });

  it('プロンプトが無ければ例外 (Templates の同期が古い)', async () => {
    const loader = { loadModularTemplate: jest.fn(async () => ({ prompts: {} })) } as unknown as YamlTemplateLoaderService;
    const service = new ArticlePointsGenerationService(loader, { sendMessage: jest.fn() } as unknown as AiProvider);

    await expect(service.generate({ 作品名: null, factLines: [], extraction: EXTRACTION, pages: [] })).rejects.toThrow(
      'prompts.write_features'
    );
  });

  it('応答を読めなければ、usage を持った ArticlePointsParseError を投げる (呼び出し側がコストを記録できるように)', async () => {
    const { service } = build('{"features": ["途中で切れ');

    const error = await service.generate({ 作品名: null, factLines: [], extraction: EXTRACTION, pages: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArticlePointsParseError);
    expect(error).toMatchObject({ model: 'test-model', usage: { totalTokens: 15 } });
  });

  it('LLM の失敗はそのまま投げる (呼び出し側が事実の行だけで続ける)', async () => {
    const { service } = build(new Error('quota'));

    await expect(service.generate({ 作品名: null, factLines: [], extraction: EXTRACTION, pages: [] })).rejects.toThrow('quota');
  });
});
