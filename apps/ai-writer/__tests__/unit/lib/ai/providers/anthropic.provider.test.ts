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

import { ClaudeIncompleteResponseError } from '@/lib/ai/claude-response';
import { AnthropicProvider } from '@/lib/ai/providers/anthropic.provider';
import { recordAiCall } from '@/lib/ai/observability/ai-call-recorder';
import { ClaudeAPIService } from '@/lib/services/claude-api.service';

/** SDK の `messages.create` を差し替える。テストごとに実装を入れ替える。 */
const mockCreate = jest.fn();

// 認証 (ID フェデレーション / プロファイル) は anthropic-client.test.ts で固定する。ここでは差し替える
jest.mock('@/lib/ai/anthropic-client', () => ({
  createAnthropicClient: jest.fn(() => ({ messages: { create: mockCreate } })),
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
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 12, output_tokens: 8 },
    content: [{ type: 'text', text }],
  };
}

describe('AnthropicProvider — 観測ログの記録契約', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(buildResponse('{"ok":1}'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('slug や抜粋を任せる ClaudeAPIService に、同じクライアントとモデルを渡す (AI_MODEL の上書きを揃える)', () => {
    const provider = new AnthropicProvider('claude-opus-5-5');

    expect(ClaudeAPIService).toHaveBeenLastCalledWith(
      (provider as unknown as { client: unknown }).client,
      'claude-opus-5-5'
    );
  });

  it('sendMessage の成功時に provider = anthropic で記録する', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { stepId: 'title-generation' });

    expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
    expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
      stepId: 'title-generation',
      // ★ 語彙の誤りをここで止める (PR #296 の gemini → google で実際に踏んだ)
      provider: 'anthropic',
      resolvedModel: 'claude-sonnet-5-5',
      requestId: 'msg_test',
      finishReason: 'end_turn',
    });
    // Claude には temperature を送らないので、記録にも残さない
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBeUndefined();
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

  // 2026-10-11 Sonnet 5.5 へ移行。temperature は既定値以外だと 400、thinking を省くと effort high で動く
  it('呼び出し元が temperature を渡しても送らず、記録もしない', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { temperature: 0.7 });

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBeUndefined();
  });

  it('adaptive thinking と effort low を送り、max_tokens は思考の分を含めて下限を設ける', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { maxTokens: 500 });

    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.max_tokens).toBe(16_000);
  });

  it('返答の上限が下限より大きければ、そのまま使う', async () => {
    const provider = new AnthropicProvider();
    await provider.sendMessage('hello', { maxTokens: 20_000 });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(20_000);
  });

  it('思考を含めて max_tokens に達した応答は、切り詰めとして失敗にする', async () => {
    mockCreate.mockResolvedValue({ ...buildResponse('{"title":"途中で'), stop_reason: 'max_tokens' });
    const provider = new AnthropicProvider();

    // 型を保ったまま投げる (汎用の Error に包み直すと、上流でリトライ可否を判断できない)
    await expect(provider.sendMessage('hello', { stepId: 'content-generation' })).rejects.toBeInstanceOf(
      ClaudeIncompleteResponseError
    );
    expect(mockedRecordAiCall.mock.calls[0][0].error).toMatch(/truncated/);
  });

  it('拒否は分類の名前付きで失敗にする', async () => {
    mockCreate.mockResolvedValue({
      ...buildResponse(''),
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
    });
    const provider = new AnthropicProvider();

    await expect(provider.sendMessage('hello', { stepId: 'title-generation' })).rejects.toThrow(
      /refused the request \(category: general_harms\)/
    );
  });

  it('応答の先頭が thinking のブロックでも、text のブロックを返す', async () => {
    mockCreate.mockResolvedValue({
      ...buildResponse('本文'),
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: '本文' },
      ],
    });
    const provider = new AnthropicProvider();

    const result = await provider.sendMessage('hello');

    expect(result.content).toBe('本文');
  });

  it('text のブロックが無ければ失敗として記録する', async () => {
    mockCreate.mockResolvedValue({
      ...buildResponse(''),
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
    });
    const provider = new AnthropicProvider();

    await expect(provider.sendMessage('hello', { stepId: 'title-generation' })).rejects.toThrow(
      /No text content/
    );
    expect(mockedRecordAiCall.mock.calls[0][0].error).toMatch(/No text content/);
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

  it('extractFromRss も temperature を送らず、思考の設定を送る', async () => {
    mockCreate.mockResolvedValue(
      buildResponse('{"workTitle":"作品","storeName":"店","eventTypeName":"コラボカフェ"}')
    );
    const provider = new AnthropicProvider();

    await provider.extractFromRss({ title: 't', content: 'c' });

    const params = mockCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('temperature');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBeUndefined();
  });
});
