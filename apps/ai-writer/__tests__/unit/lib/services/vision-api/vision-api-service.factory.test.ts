/**
 * Layer 1 contract tests for VisionApiServiceFactory.
 *
 * The factory maps a `VisionProvider` value to a concrete service class. Those
 * values are vendor names (`openai` / `anthropic`) so that they line up with
 * `AiProviderType`; a typo in the switch would previously have gone unnoticed
 * because the only coverage was the LIVE_API-gated e2e suite, which is skipped
 * whenever the API keys are absent (i.e. in CI).
 *
 * An explicit `apiKey` is passed on every construction so that no environment
 * variable is read, and both vendor SDKs are mocked (same pattern as
 * `openai-vision.service.test.ts` / `claude-vision.service.test.ts`) so that no
 * client is really instantiated and no network call is made.
 */

import { MediaResolution, ThinkingLevel } from '@google/genai';
import { VisionApiServiceFactory } from '@/lib/services/vision-api/vision-api-service.factory';
import { OpenAiVisionService } from '@/lib/services/vision-api/openai-vision.service';
import { ClaudeVisionService } from '@/lib/services/vision-api/claude-vision.service';
import { GeminiVisionService } from '@/lib/services/vision-api/gemini-vision.service';
import type { VisionProvider } from '@/lib/types/vision-api';

jest.mock('openai');
jest.mock('@anthropic-ai/sdk');
jest.mock('@google/genai', () => {
  // `ThinkingLevel` / `MediaResolution` は実体を使う (lib/config/gemini-models.ts が依存)
  const actual = jest.requireActual('@google/genai');
  return { ...actual, GoogleGenAI: jest.fn(() => ({ models: { generateContent: jest.fn() } })) };
});

const DUMMY_API_KEY = 'test-dummy-key-not-a-real-credential';

/** `create()` が返した Gemini service の private 設定を読むための最小限のヘルパ */
function geminiInternals(service: unknown): {
  modelName: string;
  mediaResolution: MediaResolution;
  thinkingLevel: ThinkingLevel;
} {
  return service as unknown as {
    modelName: string;
    mediaResolution: MediaResolution;
    thinkingLevel: ThinkingLevel;
  };
}

describe('VisionApiServiceFactory — provider selection', () => {
  const ORIGINAL_PROVIDER = process.env.VISION_API_PROVIDER;
  const ORIGINAL_MODEL = process.env.VISION_API_MODEL;
  const ORIGINAL_RESOLUTION = process.env.VISION_API_MEDIA_RESOLUTION;
  const ORIGINAL_THINKING = process.env.VISION_API_THINKING_LEVEL;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    restore('VISION_API_PROVIDER', ORIGINAL_PROVIDER);
    restore('VISION_API_MODEL', ORIGINAL_MODEL);
    restore('VISION_API_MEDIA_RESOLUTION', ORIGINAL_RESOLUTION);
    restore('VISION_API_THINKING_LEVEL', ORIGINAL_THINKING);
  });

  it("'openai' で OpenAiVisionService を返す", () => {
    const service = VisionApiServiceFactory.create('openai', { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(OpenAiVisionService);
    expect(service.getProviderName()).toBe('openai');
  });

  it("'anthropic' で ClaudeVisionService を返す (ベンダー名での指定)", () => {
    const service = VisionApiServiceFactory.create('anthropic', { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(ClaudeVisionService);
    expect(service.getProviderName()).toBe('anthropic');
  });

  it('明示指定は VISION_API_PROVIDER env より優先される', () => {
    process.env.VISION_API_PROVIDER = 'openai';
    const service = VisionApiServiceFactory.create('anthropic', { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(ClaudeVisionService);
  });

  it('env の VISION_API_PROVIDER=anthropic で ClaudeVisionService を返す', () => {
    process.env.VISION_API_PROVIDER = 'anthropic';
    const service = VisionApiServiceFactory.create(undefined, { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(ClaudeVisionService);
  });

  it('未指定時は openai にフォールバックする', () => {
    delete process.env.VISION_API_PROVIDER;
    const service = VisionApiServiceFactory.create(undefined, { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(OpenAiVisionService);
    expect(VisionApiServiceFactory.getDefaultProvider()).toBe('openai');
  });

  it('未知のプロバイダーは throw する (旧値 claude を含む)', () => {
    // 'claude' は 2026-08-11 に 'anthropic' へリネームされた旧値。後方互換 alias は
    // 意図的に設けていないため、旧値を渡した場合は黙って動くのではなく落ちる。
    expect(() =>
      VisionApiServiceFactory.create('claude' as unknown as VisionProvider, {
        apiKey: DUMMY_API_KEY,
      })
    ).toThrow(/Unknown Vision API provider: claude/);
  });

  it('エラーメッセージがサポート対象をベンダー名で提示する', () => {
    // 'gemini' は AI_PROVIDER と同じく 'google' へ統一済みの旧値。alias は設けない。
    expect(() =>
      VisionApiServiceFactory.create('gemini' as unknown as VisionProvider, {
        apiKey: DUMMY_API_KEY,
      })
    ).toThrow(/Supported providers: openai, anthropic, google/);
  });

  it("'google' で GeminiVisionService を返す", () => {
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(GeminiVisionService);
    expect(service.getProviderName()).toBe('google');
  });

  it('env の VISION_API_PROVIDER=google で GeminiVisionService を返す', () => {
    process.env.VISION_API_PROVIDER = 'google';
    const service = VisionApiServiceFactory.create(undefined, { apiKey: DUMMY_API_KEY });
    expect(service).toBeInstanceOf(GeminiVisionService);
  });
});

describe('VisionApiServiceFactory — model / Gemini 固有設定の解決', () => {
  const ORIGINAL_MODEL = process.env.VISION_API_MODEL;
  const ORIGINAL_RESOLUTION = process.env.VISION_API_MEDIA_RESOLUTION;
  const ORIGINAL_THINKING = process.env.VISION_API_THINKING_LEVEL;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    delete process.env.VISION_API_MODEL;
    delete process.env.VISION_API_MEDIA_RESOLUTION;
    delete process.env.VISION_API_THINKING_LEVEL;
  });

  afterEach(() => {
    restore('VISION_API_MODEL', ORIGINAL_MODEL);
    restore('VISION_API_MEDIA_RESOLUTION', ORIGINAL_RESOLUTION);
    restore('VISION_API_THINKING_LEVEL', ORIGINAL_THINKING);
  });

  it('VISION_API_MODEL を Gemini service へ渡す', () => {
    process.env.VISION_API_MODEL = 'gemini-3.5-flash-lite';
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(service.getModelName()).toBe('gemini-3.5-flash-lite');
  });

  it('VISION_API_MODEL は OpenAI / Anthropic にも効く', () => {
    process.env.VISION_API_MODEL = 'gpt-4o';
    expect(
      VisionApiServiceFactory.create('openai', { apiKey: DUMMY_API_KEY }).getModelName()
    ).toBe('gpt-4o');

    process.env.VISION_API_MODEL = 'claude-3-5-haiku-20241022';
    expect(
      VisionApiServiceFactory.create('anthropic', { apiKey: DUMMY_API_KEY }).getModelName()
    ).toBe('claude-3-5-haiku-20241022');
  });

  it('VISION_API_MODEL 未設定なら各 service の既定モデルのまま (既定を変えない)', () => {
    expect(
      VisionApiServiceFactory.create('openai', { apiKey: DUMMY_API_KEY }).getModelName()
    ).toBe('gpt-4o-mini');
    expect(
      VisionApiServiceFactory.create('anthropic', { apiKey: DUMMY_API_KEY }).getModelName()
    ).toBe('claude-sonnet-4-5-20250929');
    expect(
      VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY }).getModelName()
    ).toBe('gemini-3.6-flash');
  });

  /**
   * 🔴 Gemini 側の既定 media resolution は high 相当で、画像 1 枚 1,083 入力トークン
   * かかる (low は 252)。明示しないとコストが 4.2 倍になるため既定を low に倒している。
   */
  it('VISION_API_MEDIA_RESOLUTION 未設定なら LOW を使う', () => {
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(geminiInternals(service).mediaResolution).toBe(
      MediaResolution.MEDIA_RESOLUTION_LOW
    );
  });

  it('VISION_API_MEDIA_RESOLUTION=medium を反映する', () => {
    process.env.VISION_API_MEDIA_RESOLUTION = 'medium';
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(geminiInternals(service).mediaResolution).toBe(
      MediaResolution.MEDIA_RESOLUTION_MEDIUM
    );
  });

  it('VISION_API_THINKING_LEVEL=minimal を反映する', () => {
    process.env.VISION_API_THINKING_LEVEL = 'minimal';
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(geminiInternals(service).thinkingLevel).toBe(ThinkingLevel.MINIMAL);
  });

  it('VISION_API_THINKING_LEVEL 未設定なら LOW を使う', () => {
    const service = VisionApiServiceFactory.create('google', { apiKey: DUMMY_API_KEY });
    expect(geminiInternals(service).thinkingLevel).toBe(ThinkingLevel.LOW);
  });
});
