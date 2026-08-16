/**
 * Layer 1 contract tests for the AI provider factory.
 *
 * ⚠️ **最重要は「既定を変えない」ことの固定である。**
 * `AI_MODEL` / `AI_THINKING_LEVEL` は 2026-08-16 に追加した env で、Gemini を実測比較
 * できるようにするのが目的。**未設定時に OpenAI / Anthropic の挙動が 1 mm も動かない**
 * ことをここで固定しておかないと、Gemini 対応の副作用で既存の生成が変わっていても
 * 誰も気づけない。
 */

import { ThinkingLevel } from '@google/genai';
import {
  createAiProvider,
  getConfiguredModel,
  getConfiguredProvider,
  getConfiguredThinkingLevel,
} from '@/lib/ai/factory/ai-factory';
import { AnthropicProvider } from '@/lib/ai/providers/anthropic.provider';
import { GeminiProvider } from '@/lib/ai/providers/gemini.provider';
import { OpenAIProvider } from '@/lib/ai/providers/openai.provider';

jest.mock('openai');
// `anthropic.provider.ts` は名前付き import (`{ Anthropic }`) を使うため、automock では
// コンストラクタにならない。明示的に両方の export をコンストラクタとして与える。
jest.mock('@anthropic-ai/sdk', () => {
  const AnthropicMock = jest.fn();
  return { __esModule: true, default: AnthropicMock, Anthropic: AnthropicMock };
});
jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return { ...actual, GoogleGenAI: jest.fn(() => ({ models: { generateContent: jest.fn() } })) };
});

/** provider の private フィールドを読むための最小限のヘルパ */
function internals(provider: unknown): { modelName: string; thinkingLevel?: ThinkingLevel } {
  return provider as unknown as { modelName: string; thinkingLevel?: ThinkingLevel };
}

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_THINKING_LEVEL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
] as const;

describe('ai-factory', () => {
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  });

  beforeEach(() => {
    // 各 provider の constructor がキー必須なのでダミーを与える
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.AI_MODEL;
    delete process.env.AI_THINKING_LEVEL;
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  describe('getConfiguredProvider', () => {
    it.each(['anthropic', 'google', 'openai'] as const)('%s をそのまま返す', (value) => {
      process.env.AI_PROVIDER = value;
      expect(getConfiguredProvider()).toBe(value);
    });

    it('未知の値は anthropic へフォールバックする', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.AI_PROVIDER = 'gemini'; // 2026-08-11 に google へ統一した旧値
      expect(getConfiguredProvider()).toBe('anthropic');
      warn.mockRestore();
    });
  });

  describe('getConfiguredModel', () => {
    it('未設定なら undefined (= provider の既定を使う)', () => {
      expect(getConfiguredModel()).toBeUndefined();
    });

    it('空文字・空白のみも undefined として扱う', () => {
      process.env.AI_MODEL = '   ';
      expect(getConfiguredModel()).toBeUndefined();
    });

    it('設定値を trim して返す', () => {
      process.env.AI_MODEL = '  gemini-3.5-flash-lite  ';
      expect(getConfiguredModel()).toBe('gemini-3.5-flash-lite');
    });
  });

  describe('getConfiguredThinkingLevel', () => {
    it('未設定なら LOW', () => {
      expect(getConfiguredThinkingLevel()).toBe(ThinkingLevel.LOW);
    });

    it('AI_THINKING_LEVEL を反映する', () => {
      process.env.AI_THINKING_LEVEL = 'minimal';
      expect(getConfiguredThinkingLevel()).toBe(ThinkingLevel.MINIMAL);
    });
  });

  describe('createAiProvider — 既定を変えない', () => {
    it('AI_MODEL 未設定なら OpenAI は gpt-5.4-mini のまま', () => {
      process.env.AI_PROVIDER = 'openai';
      const provider = createAiProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(internals(provider).modelName).toBe('gpt-5.4-mini');
    });

    it('AI_MODEL 未設定なら Anthropic は Claude Sonnet 4.5 のまま', () => {
      process.env.AI_PROVIDER = 'anthropic';
      const provider = createAiProvider();
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(internals(provider).modelName).toBe('claude-sonnet-4-5-20250929');
    });

    it('AI_MODEL 未設定なら Gemini は gemini-3.6-flash', () => {
      process.env.AI_PROVIDER = 'google';
      const provider = createAiProvider();
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(internals(provider).modelName).toBe('gemini-3.6-flash');
    });
  });

  describe('createAiProvider — env による切り替え', () => {
    it('AI_MODEL を Gemini へ渡す', () => {
      process.env.AI_PROVIDER = 'google';
      process.env.AI_MODEL = 'gemini-3.5-flash-lite';
      expect(internals(createAiProvider()).modelName).toBe('gemini-3.5-flash-lite');
    });

    it('AI_MODEL は OpenAI にも効く (全プロバイダ共通の env)', () => {
      process.env.AI_PROVIDER = 'openai';
      process.env.AI_MODEL = 'gpt-5-mini';
      expect(internals(createAiProvider()).modelName).toBe('gpt-5-mini');
    });

    it('AI_THINKING_LEVEL を Gemini へ渡す', () => {
      process.env.AI_PROVIDER = 'google';
      process.env.AI_THINKING_LEVEL = 'medium';
      expect(internals(createAiProvider()).thinkingLevel).toBe(ThinkingLevel.MEDIUM);
    });

    it('AI_THINKING_LEVEL 未設定なら Gemini は LOW', () => {
      process.env.AI_PROVIDER = 'google';
      expect(internals(createAiProvider()).thinkingLevel).toBe(ThinkingLevel.LOW);
    });
  });
});
