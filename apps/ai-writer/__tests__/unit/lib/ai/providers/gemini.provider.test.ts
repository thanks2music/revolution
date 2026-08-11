/**
 * Layer 2 contract tests for GeminiProvider — 観測ログの記録契約に絞る。
 *
 * このファイルは本 PR で新設した。`gemini.provider.ts` にはこれまでテストが 1 件も
 * 無かった。
 *
 * ⚠️ **本ファイルの最重要ケースは `provider: 'google'` の固定である。**
 * PR #296 で `AiProviderType` が `gemini` → `google` へ移ったとき、`gemini.provider.ts`
 * は #296 の変更対象に入っておらず、observability 側だけが廃止済みの `'gemini'` を
 * 書き続けていた。`AiCallRecord.provider` が `string` だったため型でも検出できず、
 * テストも無かったため誰も気づけなかった。同じ形の再発をここで止める。
 */

import { GeminiProvider } from '@/lib/ai/providers/gemini.provider';
import { recordAiCall } from '@/lib/ai/observability/ai-call-recorder';

/** `getGenerativeModel()` が返すモデルの `generateContent`。 */
const mockGenerateContent = jest.fn();
/** モデル生成時に渡された引数を検査するための spy。 */
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

jest.mock('@/lib/ai/observability/ai-call-recorder', () => ({
  recordAiCall: jest.fn(async () => {}),
  hashForAiCallRecord: (v: string) => `sha-${v.length}`,
  shouldSuppressInlinePromptDump: () => false,
}));

const mockedRecordAiCall = recordAiCall as unknown as jest.Mock;

function buildResponse(text: string, modelVersion?: string) {
  return {
    response: {
      text: () => text,
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, totalTokenCount: 15 },
      candidates: [{ finishReason: 'STOP' }],
      ...(modelVersion ? { modelVersion } : {}),
    },
  };
}

const RSS_JSON = '{"workTitle":"作品","storeName":"店","eventTypeName":"コラボカフェ"}';

describe('GeminiProvider — 観測ログの記録契約', () => {
  const ORIGINAL_API_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue(buildResponse('{"ok":1}'));
    mockGetGenerativeModel.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (ORIGINAL_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_API_KEY;
  });

  // ★ 本ファイルの存在理由。PR #296 の語彙変更で実際にずれた箇所。
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

  // ★ `extractFromRss` は `this.model` (constructor のモデル) を使う。記録が
  //   FLASH_LITE 固定だと「呼んでいないモデル名」を書くことになる。
  it('extractFromRss は constructor で指定したモデル名を記録する', async () => {
    mockGenerateContent.mockResolvedValue(buildResponse(RSS_JSON));
    const provider = new GeminiProvider('key', 'gemini-2.5-pro');

    await provider.extractFromRss({ title: 't', content: 'c' });

    expect(mockedRecordAiCall.mock.calls[0][0].requestedModel).toBe('gemini-2.5-pro');
  });

  it('応答が modelVersion を返せば resolvedModel に採る', async () => {
    mockGenerateContent.mockResolvedValue(buildResponse('{"ok":1}', 'gemini-2.5-flash-lite-001'));
    const provider = new GeminiProvider();

    await provider.sendMessage('hello');

    expect(mockedRecordAiCall.mock.calls[0][0].resolvedModel).toBe('gemini-2.5-flash-lite-001');
  });

  it('temperature は実送信値と記録値が一致する', async () => {
    const provider = new GeminiProvider();
    await provider.sendMessage('hello', { temperature: 0.4 });

    const sentConfig = mockGetGenerativeModel.mock.calls.at(-1)?.[0] as unknown as {
      generationConfig?: { temperature?: number };
    };
    expect(sentConfig.generationConfig?.temperature).toBe(0.4);
    expect(mockedRecordAiCall.mock.calls[0][0].temperature).toBe(0.4);
  });

  /**
   * ⚠️ 既知の機能バグを**現状のまま固定する**テスト。
   *
   * `sendMessage` は `this.model` を使わず `GEMINI_MODELS.FLASH_LITE` で別のモデルを
   * 組み立て直すため、constructor のモデル指定が効かない。修正は別タスク
   * (Todoist「Gemini モデルを現行世代へ更新する」) のスコープで、そこでは本テストを
   * 「指定モデルを呼ぶ」へ書き換えることになる。
   *
   * 現状を固定しておくのは、**修正時にこのテストが落ちて意図的な変更だと分かる**ように
   * するため。落ちないまま直すと、変更が意図どおりか誰も確認できない。
   */
  it('【既知バグの固定】sendMessage は constructor のモデル指定を無視する', async () => {
    const provider = new GeminiProvider('key', 'gemini-2.5-pro');
    await provider.sendMessage('hello');

    expect(mockedRecordAiCall.mock.calls[0][0].requestedModel).toBe('gemini-2.5-flash-lite');
  });
});
