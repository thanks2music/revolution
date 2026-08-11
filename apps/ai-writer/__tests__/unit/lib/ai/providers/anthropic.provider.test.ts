/**
 * Layer 2 contract tests for AnthropicProvider — 観測ログの記録契約に絞る。
 *
 * このファイルは本 PR で新設した。`anthropic.provider.ts` にはこれまでテストが
 * 1 件も無く、追加した記録ロジック (`recordAiCall` の 4 箇所) が一切検証されて
 * いなかった。
 *
 * ⚠️ とくに **`provider` リテラルの誤り**は実際に起きた。PR #296 で
 * `AiProviderType` が `gemini` → `google` へ移ったとき、observability 側は
 * 気づかず古い語彙を書き続けていた。型を締めたうえで、テストでも固定する。
 */

import { AnthropicProvider } from '@/lib/ai/providers/anthropic.provider';
import { recordAiCall } from '@/lib/ai/observability/ai-call-recorder';

/** SDK の `messages.create` を差し替える。テストごとに実装を入れ替える。 */
const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn(() => ({ messages: { create: mockCreate } })),
}));

jest.mock('@/lib/ai/observability/ai-call-recorder', () => ({
  recordAiCall: jest.fn(async () => {}),
  hashForAiCallRecord: (v: string) => `sha-${v.length}`,
  shouldSuppressInlinePromptDump: () => false,
}));

// `ClaudeAPIService` は constructor で生成されるだけで本テストの経路では使わない
jest.mock('@/lib/services/claude-api.service', () => ({
  ClaudeAPIService: jest.fn(() => ({})),
}));

const mockedRecordAiCall = recordAiCall as unknown as jest.Mock;

function buildResponse(text: string) {
  return {
    id: 'msg_test',
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    usage: { input_tokens: 12, output_tokens: 8 },
    content: [{ type: 'text', text }],
  };
}

describe('AnthropicProvider — 観測ログの記録契約', () => {
  const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(buildResponse('{"ok":1}'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
  });

  it('sendMessage の成功時に provider = anthropic で記録する', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { stepId: 'title-generation' });

    expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
    expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
      stepId: 'title-generation',
      // ★ 語彙の誤りをここで止める (PR #296 の gemini → google で実際に踏んだ)
      provider: 'anthropic',
      resolvedModel: 'claude-sonnet-4-5-20250929',
      requestId: 'msg_test',
      finishReason: 'end_turn',
      temperature: 0,
    });
    expect(mockedRecordAiCall.mock.calls[0][0].usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });

  it('API が throw しても失敗として記録する (歩留まりを測るため)', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded'));
    const provider = new AnthropicProvider();

    await expect(provider.sendMessage('hello', { stepId: 'lead-generation' })).rejects.toThrow(
      /overloaded/
    );

    expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
    expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
      stepId: 'lead-generation',
      provider: 'anthropic',
      error: 'overloaded',
    });
  });

  it('temperature は実送信値と記録値が一致する', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { temperature: 0.7 });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.7);
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBe(0.7);
  });

  // ★ `extractFromRss` は `sendMessage` を経由しない独自実装。ここを飛ばすと
  //   rss-extraction だけが観測ログから欠落する (「一部にしか適用していない」の形)。
  it('extractFromRss も rss-extraction として記録する', async () => {
    mockCreate.mockResolvedValue(
      buildResponse('{"workTitle":"作品","storeName":"店","eventTypeName":"コラボカフェ"}')
    );
    const provider = new AnthropicProvider();

    await provider.extractFromRss({ title: 't', content: 'c' });

    expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
    expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
      stepId: 'rss-extraction',
      provider: 'anthropic',
    });
  });

  it('extractFromRss の temperature も実送信値と一致する', async () => {
    mockCreate.mockResolvedValue(
      buildResponse('{"workTitle":"作品","storeName":"店","eventTypeName":"コラボカフェ"}')
    );
    const provider = new AnthropicProvider();

    await provider.extractFromRss({ title: 't', content: 'c' });

    const sent = mockCreate.mock.calls[0][0].temperature;
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBe(sent);
  });
});
