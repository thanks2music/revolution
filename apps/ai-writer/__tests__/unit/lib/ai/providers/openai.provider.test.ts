/**
 * Layer 2 contract tests for OpenAIProvider.
 *
 * Verifies the boundary between Revolution-side AiProvider interface and the
 * openai-node SDK, focused on model selection (gpt-5.4-mini default after the
 * 2026-06-07 migration from gpt-4.1-mini) and request shape.
 */

import OpenAI from 'openai';
import { OpenAIProvider } from '@/lib/ai/providers/openai.provider';

jest.mock('openai');

const MockedOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;

function buildSendMessageResponse(content: string) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-5.4-mini',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      },
    ],
  };
}

describe('OpenAIProvider — Layer 2 contract', () => {
  const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;
  let mockChatCompletionsCreate: jest.Mock;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    mockChatCompletionsCreate = jest.fn().mockResolvedValue(buildSendMessageResponse('ok'));
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: { create: mockChatCompletionsCreate },
          },
        }) as unknown as OpenAI,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
    }
  });

  it('throws when OPENAI_API_KEY is absent and no apiKey override is given', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(/OpenAI API key is required/);
  });

  it('sends sendMessage requests with model = gpt-5.4-mini by default', async () => {
    const provider = new OpenAIProvider();
    await provider.sendMessage('hello');

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.model).toBe('gpt-5.4-mini');
    expect(call.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('passes response_format = { type: "json_object" } when responseFormat is "json"', async () => {
    const provider = new OpenAIProvider();
    await provider.sendMessage('return json', { responseFormat: 'json' });

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'json_object' });
  });

  it('honors the modelName constructor override (e.g. gpt-5.5 for premium tier)', async () => {
    const provider = new OpenAIProvider(undefined, 'gpt-5.5');
    await provider.sendMessage('premium request');

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.model).toBe('gpt-5.5');
  });

  it('uses max_completion_tokens (not legacy max_tokens) for GPT-5 reasoning models', async () => {
    // GPT-5 family rejects `max_tokens` with HTTP 400 `unsupported_parameter`
    // (verified live against gpt-5.4-mini via debug:mdx --dry-run).
    const provider = new OpenAIProvider();
    await provider.sendMessage('hello', { maxTokens: 1024 });

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.max_completion_tokens).toBe(1024);
    expect(call.max_tokens).toBeUndefined();
  });

  it('passes response_format = json_schema with strict:true when responseSchema is provided', async () => {
    const provider = new OpenAIProvider();
    const schema = {
      type: 'object',
      properties: { foo: { type: 'string' } },
      required: ['foo'],
      additionalProperties: false,
    };
    await provider.sendMessage('extract', {
      responseFormat: 'json',
      responseSchema: { name: 'FooResponse', schema },
    });

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'FooResponse',
        schema,
        strict: true,
      },
    });
  });

  it('prefers responseSchema over responseFormat when both are given (strict mode wins over json_object)', async () => {
    // Regression guard: extraction.service.ts passes both to keep the Anthropic/Gemini fallback
    // intact; OpenAI must ignore the weaker json_object hint when a schema is present.
    const provider = new OpenAIProvider();
    await provider.sendMessage('extract', {
      responseFormat: 'json',
      responseSchema: {
        name: 'X',
        schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    });

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.response_format.type).toBe('json_schema');
  });

  it('throws with an explicit refusal message when message.refusal is populated (Structured Outputs safety refusal)', async () => {
    // OpenAI Structured Outputs can return message.refusal instead of content when the model
    // declines to comply with the schema. Silently reading empty content would surface a
    // misleading "No JSON found" error downstream — the provider must translate this into a
    // clear model-refused error at the boundary.
    mockChatCompletionsCreate.mockResolvedValueOnce({
      id: 'chatcmpl_refusal',
      object: 'chat.completion',
      created: Math.floor(1_700_000_000),
      model: 'gpt-5.4-mini',
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: null,
            refusal: 'I cannot extract data from this URL.',
          },
        },
      ],
    });
    const provider = new OpenAIProvider();
    await expect(provider.sendMessage('extract', { responseFormat: 'json' })).rejects.toThrow(
      /model refused.*I cannot extract data/
    );
  });

  it('leaves response_format unset when neither responseFormat nor responseSchema is given', async () => {
    const provider = new OpenAIProvider();
    await provider.sendMessage('plain text');

    const call = mockChatCompletionsCreate.mock.calls[0][0];
    expect(call.response_format).toBeUndefined();
  });
});
