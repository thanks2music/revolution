/**
 * Layer 2: 記事選別の「判定できなかった」と「対象外」を分ける契約。
 *
 * 以前は AI の呼び出しや応答の解析に失敗すると `should_generate: false` を返し、
 * パイプラインはそれを「スキップ」として扱っていた。AI の障害・キーの失効・残高切れでも
 * 全記事が黙ってスキップされ、誰も気づけなかった。
 * 失敗は例外として投げ、AI が「対象外」と判定した時だけ `should_generate: false` を返す。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ArticleSelectionService } from '@/lib/services/article-selection.service';

jest.mock('@/lib/ai/observability/ai-call-recorder', () => ({
  shouldSuppressInlinePromptDump: jest.fn(() => false),
  recordAiCall: jest.fn(async () => {}),
  hashForAiCallRecord: (v: string) => `sha-${v.length}`,
}));

const REQUEST = { rss_title: 't', rss_content: 'c' };

function buildService(sendMessage: jest.Mock) {
  const templateLoader = {
    loadModularTemplate: jest.fn(async () => ({
      prompts: { selection: 'テスト用プロンプト' },
      logic: {},
      output: {},
    })),
  };
  return new ArticleSelectionService(templateLoader as any, { sendMessage } as any);
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('記事選別の失敗', () => {
  it('AI の呼び出しが失敗したら、スキップを返さずに投げる (元の error を cause に残す)', async () => {
    const apiError = new Error('API key not valid');
    const service = buildService(jest.fn(async () => Promise.reject(apiError)));

    const thrown = await service.shouldGenerateArticle(REQUEST).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('記事選別に失敗: API key not valid');
    expect((thrown as Error).cause).toBe(apiError);
  });

  it('応答が JSON として読めない時も投げる', async () => {
    const service = buildService(
      jest.fn(async () => ({ content: 'JSON ではない応答', model: 'gemini' })),
    );

    await expect(service.shouldGenerateArticle(REQUEST)).rejects.toThrow(/^記事選別に失敗: /);
  });

  it('JSON は読めても必須の項目が欠けていたら投げる', async () => {
    const content = JSON.stringify({ should_generate: true, primary_official_url: null });
    const service = buildService(jest.fn(async () => ({ content, model: 'gemini' })));

    await expect(service.shouldGenerateArticle(REQUEST)).rejects.toThrow(
      '記事選別に失敗: Failed to parse selection response: Missing or invalid official_urls field',
    );
  });

  it('AI が「対象外」と判定した時は投げずに should_generate: false を返す', async () => {
    const content = JSON.stringify({
      should_generate: false,
      primary_official_url: null,
      official_urls: [],
      reason: '公式URLなし',
    });
    const service = buildService(jest.fn(async () => ({ content, model: 'gemini' })));

    const result = await service.shouldGenerateArticle(REQUEST);

    expect(result.should_generate).toBe(false);
    expect(result.reason).toBe('公式URLなし');
  });
});
