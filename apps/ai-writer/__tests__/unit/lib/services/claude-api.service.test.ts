/**
 * Layer 2 tests for ClaudeAPIService — Sonnet 5.5 への移行で変えた経路に絞る。
 *
 * AnthropicProvider の generateSlug / generateExcerpt はこのサービスに委ねている
 * (AI_PROVIDER=anthropic の slug の AI フォールバックと抜粋)。
 */

import { ClaudeIncompleteResponseError } from '@/lib/ai/claude-response';
import type Anthropic from '@anthropic-ai/sdk';

import { ClaudeAPIService } from '@/lib/services/claude-api.service';

const mockCreate = jest.fn();
/** 認証は createAnthropicClient の責務。ここではクライアントを直接渡す */
const fakeClient = { messages: { create: mockCreate } } as unknown as Anthropic;


jest.mock('@extractus/article-extractor', () => ({ extract: jest.fn() }));

function buildResponse(text: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
    ...overrides,
  };
}

describe('ClaudeAPIService — Sonnet 5.5', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generateSlug は temperature を送らず、思考の設定と max_tokens の下限を送る', async () => {
    mockCreate.mockResolvedValue(buildResponse('jujutsu-kaisen'));
    const service = new ClaudeAPIService(fakeClient);

    await expect(service.generateSlug('呪術廻戦')).resolves.toBe('jujutsu-kaisen');

    const params = mockCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('temperature');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.max_tokens).toBe(16_000);
  });

  it('generateSlug は拒否されたら、従来どおりタイトルから作った slug に退避する', async () => {
    mockCreate.mockResolvedValue(
      buildResponse('', {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
        content: [],
      })
    );
    const service = new ClaudeAPIService(fakeClient);

    await expect(service.generateSlug('Spy Family')).resolves.toBe('spy-family');
  });

  it('generateExcerpt は max_tokens で切れた応答を失敗にする', async () => {
    mockCreate.mockResolvedValue(buildResponse('途中まで', { stop_reason: 'max_tokens' }));
    const service = new ClaudeAPIService(fakeClient);

    await expect(service.generateExcerpt('本文')).rejects.toThrow(/truncated/);
  });
});
