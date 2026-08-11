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

import { VisionApiServiceFactory } from '@/lib/services/vision-api/vision-api-service.factory';
import { OpenAiVisionService } from '@/lib/services/vision-api/openai-vision.service';
import { ClaudeVisionService } from '@/lib/services/vision-api/claude-vision.service';
import type { VisionProvider } from '@/lib/types/vision-api';

jest.mock('openai');
jest.mock('@anthropic-ai/sdk');

const DUMMY_API_KEY = 'test-dummy-key-not-a-real-credential';

describe('VisionApiServiceFactory — provider selection', () => {
  const ORIGINAL_PROVIDER = process.env.VISION_API_PROVIDER;

  afterEach(() => {
    if (ORIGINAL_PROVIDER === undefined) {
      delete process.env.VISION_API_PROVIDER;
    } else {
      process.env.VISION_API_PROVIDER = ORIGINAL_PROVIDER;
    }
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
    expect(() =>
      VisionApiServiceFactory.create('gemini' as unknown as VisionProvider, {
        apiKey: DUMMY_API_KEY,
      })
    ).toThrow(/Supported providers: openai, anthropic/);
  });
});
