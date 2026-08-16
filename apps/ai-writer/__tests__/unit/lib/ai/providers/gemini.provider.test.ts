/**
 * Layer 2 contract tests for GeminiProvider.
 *
 * ⚠️ **本ファイルの最重要ケースは 2 つある。**
 *
 * 1. `provider: 'google'` の固定。PR #296 で `AiProviderType` が `gemini` → `google` へ
 *    移ったとき `gemini.provider.ts` は変更対象に入っておらず、observability 側だけが
 *    廃止済みの `'gemini'` を書き続けていた。型が `string` だったため検出できなかった。
 * 2. **`sendMessage` が constructor 指定のモデルを呼ぶこと。** 旧実装は `sendMessage` だけ
 *    `GEMINI_MODELS.FLASH_LITE` で上書きしており、パイプラインの AI ステップの大半が
 *    `sendMessage` を通るため「モデル指定が実質無効」だった。かつては本ファイルに
 *    「【既知バグの固定】」としてその挙動を固定するテストがあり、2026-08-16 の
 *    `@google/genai` 移行で**期待値を反転させた**。
 *
 * あわせて、移行で新たに入れた 2 つのガードも固定する:
 * - thinking トークンを出力として計上すること (合算しないと出力コストを過小計上する)
 * - `finishReason: 'MAX_TOKENS'` の切り詰め応答を正常な結果として返さないこと
 */

import { ThinkingLevel } from '@google/genai';
import { GeminiProvider } from '@/lib/ai/providers/gemini.provider';
import { recordAiCall } from '@/lib/ai/observability/ai-call-recorder';

/** `ai.models.generateContent` の spy。 */
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => {
  // `ThinkingLevel` / `MediaResolution` は実体を使う (lib/config/gemini-models.ts が依存)
  const actual = jest.requireActual('@google/genai');
  return {
    ...actual,
    GoogleGenAI: jest.fn(() => ({ models: { generateContent: mockGenerateContent } })),
  };
});

jest.mock('@/lib/ai/observability/ai-call-recorder', () => ({
  recordAiCall: jest.fn(async () => {}),
  hashForAiCallRecord: (v: string) => `sha-${v.length}`,
  shouldSuppressInlinePromptDump: () => false,
}));

const mockedRecordAiCall = recordAiCall as unknown as jest.Mock;

interface ResponseOverrides {
  modelVersion?: string;
  finishReason?: string;
  thoughtsTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

function buildResponse(text: string, overrides: ResponseOverrides = {}) {
  return {
    text,
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: overrides.candidatesTokenCount ?? 4,
      thoughtsTokenCount: overrides.thoughtsTokenCount ?? 0,
      totalTokenCount: overrides.totalTokenCount ?? 15,
    },
    candidates: [{ finishReason: overrides.finishReason ?? 'STOP' }],
    ...(overrides.modelVersion ? { modelVersion: overrides.modelVersion } : {}),
  };
}

/** 直近の `generateContent` 呼び出し引数 */
function lastRequest(): {
  model: string;
  contents: unknown;
  config: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingLevel?: string };
    responseMimeType?: string;
    responseJsonSchema?: unknown;
    systemInstruction?: string;
  };
} {
  return mockGenerateContent.mock.calls.at(-1)?.[0];
}

const RSS_JSON = '{"workTitle":"作品","storeName":"店","eventTypeName":"コラボカフェ"}';

describe('GeminiProvider', () => {
  const ORIGINAL_API_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue(buildResponse('{"ok":1}'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_API_KEY;
  });

  describe('観測ログの記録契約', () => {
    // ★ PR #296 の語彙変更で実際にずれた箇所。
    it('sendMessage は provider = google で記録する (gemini ではない)', async () => {
      const provider = new GeminiProvider();
      await provider.sendMessage('hello', { stepId: 'subpage-detection' });

      expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
      expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
        stepId: 'subpage-detection',
        provider: 'google',
        finishReason: 'STOP',
        // Gemini に system_fingerprint 相当は無い。未記録 (undefined) と区別するため null
        systemFingerprint: null,
      });
    });

    it('extractFromRss も provider = google で rss-extraction として記録する', async () => {
      mockGenerateContent.mockResolvedValue(buildResponse(RSS_JSON));
      const provider = new GeminiProvider();

      await provider.extractFromRss({ title: 't', content: 'c' });

      expect(mockedRecordAiCall).toHaveBeenCalledTimes(1);
      expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
        stepId: 'rss-extraction',
        provider: 'google',
      });
    });

    it('API が throw しても provider = google で失敗記録する', async () => {
      mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));
      const provider = new GeminiProvider();

      await expect(provider.sendMessage('hello')).rejects.toThrow(/quota exceeded/);

      expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({
        provider: 'google',
        error: 'quota exceeded',
        stepId: 'unknown',
      });
    });

    it('応答が modelVersion を返せば resolvedModel に採る', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('{"ok":1}', { modelVersion: 'gemini-3.6-flash-001' })
      );
      const provider = new GeminiProvider();

      await provider.sendMessage('hello');

      expect(mockedRecordAiCall.mock.calls[0][0].resolvedModel).toBe('gemini-3.6-flash-001');
    });

    it('temperature は実送信値と記録値が一致する', async () => {
      const provider = new GeminiProvider();
      await provider.sendMessage('hello', { temperature: 0.4 });

      expect(lastRequest().config.temperature).toBe(0.4);
      expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBe(0.4);
    });
  });

  describe('モデル解決 (旧実装の「モデル指定が効かない」バグの回帰防止)', () => {
    /**
     * ★ 旧実装ではここが `gemini-2.5-flash-lite` 固定で、「【既知バグの固定】」として
     *   テストされていた。`@google/genai` 移行で期待値を反転させたケース。
     */
    it('sendMessage は constructor で指定したモデルを呼ぶ', async () => {
      const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite');
      await provider.sendMessage('hello');

      expect(lastRequest().model).toBe('gemini-3.5-flash-lite');
      expect(mockedRecordAiCall.mock.calls[0][0].requestedModel).toBe('gemini-3.5-flash-lite');
    });

    it('extractFromRss も constructor で指定したモデルを呼ぶ', async () => {
      mockGenerateContent.mockResolvedValue(buildResponse(RSS_JSON));
      const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite');

      await provider.extractFromRss({ title: 't', content: 'c' });

      expect(lastRequest().model).toBe('gemini-3.5-flash-lite');
      expect(mockedRecordAiCall.mock.calls[0][0].requestedModel).toBe('gemini-3.5-flash-lite');
    });

    it('generateSlug も constructor で指定したモデルを呼ぶ', async () => {
      mockGenerateContent.mockResolvedValue(buildResponse('kusuriya-no-hitorigoto'));
      const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite');

      await provider.generateSlug('薬屋のひとりごと');

      expect(lastRequest().model).toBe('gemini-3.5-flash-lite');
    });

    it('モデル未指定なら既定の gemini-3.6-flash を呼ぶ', async () => {
      const provider = new GeminiProvider('key');
      await provider.sendMessage('hello');

      expect(lastRequest().model).toBe('gemini-3.6-flash');
    });
  });

  describe('thinking の設定と課金計上', () => {
    it('constructor で指定した thinkingLevel を config へ渡す', async () => {
      const provider = new GeminiProvider('key', 'gemini-3.6-flash', ThinkingLevel.MINIMAL);
      await provider.sendMessage('hello');

      expect(lastRequest().config.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.MINIMAL);
    });

    it('thinkingLevel 未指定なら既定の LOW を渡す', async () => {
      const provider = new GeminiProvider('key');
      await provider.sendMessage('hello');

      expect(lastRequest().config.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.LOW);
    });

    /**
     * 🔴 thinking トークンは出力として課金される。`candidatesTokenCount` とは別建てで
     * 返るため、合算しないと出力コストを過小計上する。
     */
    it('thinking トークンを completionTokens に合算する', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('{"ok":1}', {
          candidatesTokenCount: 3,
          thoughtsTokenCount: 68,
          totalTokenCount: 84,
        })
      );
      const provider = new GeminiProvider('key');

      const result = await provider.sendMessage('hello');

      expect(result.usage).toEqual({
        promptTokens: 11,
        completionTokens: 71, // 3 (candidates) + 68 (thoughts)
        totalTokens: 84,
      });
    });

    /**
     * 🔴 Gemini の `maxOutputTokens` は thinking トークンも含む。呼び出し側の
     * `maxTokens` をそのまま渡すと thinking に食い潰されて出力が切れるため、
     * thinking レベルに応じた余裕枠を上乗せする。
     */
    it('maxTokens に thinking の余裕枠を上乗せする', async () => {
      const provider = new GeminiProvider('key', 'gemini-3.6-flash', ThinkingLevel.LOW);
      await provider.sendMessage('hello', { maxTokens: 100 });

      expect(lastRequest().config.maxOutputTokens).toBeGreaterThan(100);
    });

    it('thinking が MINIMAL なら余裕枠を足さない', async () => {
      const provider = new GeminiProvider('key', 'gemini-3.6-flash', ThinkingLevel.MINIMAL);
      await provider.sendMessage('hello', { maxTokens: 100 });

      expect(lastRequest().config.maxOutputTokens).toBe(100);
    });
  });

  describe('切り詰め応答のガード', () => {
    /**
     * 🔴 Gemini は `maxOutputTokens` に達しても例外を投げず、途中までの文字列を返す。
     * 実測 (2026-08-16): `maxTokens: 100` + thinking LOW で slug が `kusuriya-` になった。
     * そのまま返すと壊れた slug が記事 URL になるため loud に停める。
     */
    it('finishReason=MAX_TOKENS の応答は切り詰めとして throw する', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('kusuriya-', { finishReason: 'MAX_TOKENS', thoughtsTokenCount: 92 })
      );
      const provider = new GeminiProvider('key');

      await expect(provider.sendMessage('hello')).rejects.toThrow(/truncated|MAX_TOKENS/);
    });

    it('切り詰めでも失敗として観測ログに残す', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('kusuriya-', { finishReason: 'MAX_TOKENS' })
      );
      const provider = new GeminiProvider('key');

      await expect(provider.sendMessage('hello')).rejects.toThrow();

      expect(mockedRecordAiCall.mock.calls[0][0]).toMatchObject({ provider: 'google' });
      expect(mockedRecordAiCall.mock.calls[0][0].error).toMatch(/MAX_TOKENS/);
    });
  });

  describe('構造化出力', () => {
    /**
     * 旧実装は `responseMimeType: 'application/json'` (JSON mode) 止まりで
     * スキーマ準拠を強制していなかった。その非対称が会場網羅ゲートの
     * `systematic` 誤診断を招いた実績がある (`venue-completeness-gate.ts`)。
     */
    it('responseSchema を responseJsonSchema として渡す', async () => {
      const schema = {
        type: 'object',
        properties: { workTitle: { type: 'string' } },
        required: ['workTitle'],
        additionalProperties: false,
      };
      const provider = new GeminiProvider('key');

      await provider.sendMessage('hello', {
        responseSchema: { name: 'ExtractionResponse', schema },
      });

      expect(lastRequest().config.responseJsonSchema).toEqual(schema);
      expect(lastRequest().config.responseMimeType).toBe('application/json');
    });

    it('responseFormat: json だけなら JSON mode のみ有効にする', async () => {
      const provider = new GeminiProvider('key');
      await provider.sendMessage('hello', { responseFormat: 'json' });

      expect(lastRequest().config.responseMimeType).toBe('application/json');
      expect(lastRequest().config.responseJsonSchema).toBeUndefined();
    });

    it('systemPrompt は systemInstruction として渡す', async () => {
      const provider = new GeminiProvider('key');
      await provider.sendMessage('hello', { systemPrompt: 'You are a helper.' });

      expect(lastRequest().config.systemInstruction).toBe('You are a helper.');
    });
  });
});
