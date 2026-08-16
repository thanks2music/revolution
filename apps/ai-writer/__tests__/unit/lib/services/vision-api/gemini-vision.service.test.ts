/**
 * Layer 2 contract tests for GeminiVisionService.
 *
 * ⚠️ **本ファイルの最重要ケースは「画像を inlineData で送ること」である。**
 * Gemini は `fileData.fileUri` に公開 HTTPS URL を渡すと **429 RESOURCE_EXHAUSTED が
 * 恒常的に返る** (2026-08-16 に 2 回実測。直後の inlineData 呼び出しは成功するので
 * アカウントの quota ではない)。OpenAI (`image_url`) / Claude (`source.type: 'url'`) と
 * 違い、**この provider だけ画像を自前でダウンロードして base64 で送る**。
 * ここが URL 直渡しに戻ると全 Vision 呼び出しが 429 で落ちる。
 *
 * あわせて以下も固定する:
 * - `mediaResolution` / `thinkingLevel` が config へ渡ること (どちらもコスト直結)
 * - thinking トークンを出力として計上すること
 * - 切り詰め応答 (`MAX_TOKENS`) を正常な結果として返さないこと
 * - 画像取得に失敗しても throw せず空配列で返す既存契約を壊さないこと
 */

import { MediaResolution, ThinkingLevel } from '@google/genai';
import { GeminiVisionService } from '@/lib/services/vision-api/gemini-vision.service';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return {
    ...actual,
    GoogleGenAI: jest.fn(() => ({ models: { generateContent: mockGenerateContent } })),
  };
});

// ログのファイル書き出しを止める (テストで logs/ を汚さない)
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: { writeFile: jest.fn(async () => {}) },
}));

const DUMMY_API_KEY = 'test-dummy-key-not-a-real-credential';
const IMAGE_URL = 'https://example.com/menu.jpg';

interface ResponseOverrides {
  finishReason?: string;
  thoughtsTokenCount?: number;
  candidatesTokenCount?: number;
}

function buildResponse(payload: unknown, overrides: ResponseOverrides = {}) {
  return {
    text:
      payload === undefined
        ? undefined
        : typeof payload === 'string'
          ? payload
          : JSON.stringify(payload),
    usageMetadata: {
      promptTokenCount: 2200,
      candidatesTokenCount: overrides.candidatesTokenCount ?? 120,
      thoughtsTokenCount: overrides.thoughtsTokenCount ?? 0,
      totalTokenCount: 2320,
    },
    candidates: [{ finishReason: overrides.finishReason ?? 'STOP' }],
    modelVersion: 'gemini-3.6-flash',
  };
}

const MENU_PAYLOAD = {
  menuItems: [{ name: 'コラボパフェ', price: 1200, characterName: ['薬屋'], confidence: 0.9 }],
  goodsItems: [],
  noveltyItems: [],
  metadata: { hasComingSoonNotice: false },
};

/** 直近の `generateContent` 呼び出し引数 */
function lastRequest() {
  return mockGenerateContent.mock.calls.at(-1)?.[0] as {
    model: string;
    contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    config: {
      mediaResolution?: MediaResolution;
      thinkingConfig?: { thinkingLevel?: ThinkingLevel };
      maxOutputTokens?: number;
      responseMimeType?: string;
    };
  };
}

/** `fetch` を成功レスポンスで差し替える */
function mockFetchOk(contentType = 'image/jpeg') {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    arrayBuffer: async () => new TextEncoder().encode('fake-image-bytes').buffer,
  })) as unknown as typeof fetch;
}

function callOptions(overrides: Record<string, unknown> = {}) {
  return {
    imageUrls: [IMAGE_URL],
    prompt: 'メニューを抽出してください',
    category: 'menu' as const,
    maxRetries: 1,
    ...overrides,
  };
}

describe('GeminiVisionService', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue(buildResponse(MENU_PAYLOAD));
    mockFetchOk();
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = ORIGINAL_FETCH;
  });

  describe('provider / model の識別', () => {
    it('provider 名は google', () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      expect(service.getProviderName()).toBe('google');
    });

    it('既定モデルは gemini-3.6-flash', () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      expect(service.getModelName()).toBe('gemini-3.6-flash');
    });

    it('config で指定したモデルを呼ぶ', async () => {
      const service = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        model: 'gemini-3.5-flash-lite',
      });
      await service.extractFromImages(callOptions());

      expect(lastRequest().model).toBe('gemini-3.5-flash-lite');
    });
  });

  describe('画像の渡し方 (Gemini 固有)', () => {
    /** ★ 本ファイルの存在理由。URL 直渡しへ戻ると全 Vision 呼び出しが 429 で落ちる。 */
    it('画像を inlineData (base64) で送り、fileData は使わない', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      const parts = lastRequest().contents[0].parts;
      const imageParts = parts.filter((p) => 'inlineData' in p);

      expect(imageParts).toHaveLength(1);
      expect(imageParts[0].inlineData).toMatchObject({ mimeType: 'image/jpeg' });
      expect(typeof (imageParts[0].inlineData as { data: string }).data).toBe('string');
      expect(parts.some((p) => 'fileData' in p)).toBe(false);
    });

    it('プロンプトは呼び出し元から渡されたものをそのまま先頭に置く', async () => {
      // プロンプトは Templates の YAML が真実源。service 側で組み立てない (SoC)。
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions({ prompt: 'ノベルティを抽出' }));

      expect(lastRequest().contents[0].parts[0]).toEqual({ text: 'ノベルティを抽出' });
    });

    it('Content-Type から MIME タイプを決める', async () => {
      mockFetchOk('image/png; charset=binary');
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      const imagePart = lastRequest().contents[0].parts.find((p) => 'inlineData' in p);
      expect(imagePart?.inlineData).toMatchObject({ mimeType: 'image/png' });
    });

    it('http(s) 以外の URL は API へ届く前に弾く', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await expect(
        service.extractFromImages(callOptions({ imageUrls: ['file:///etc/passwd'] }))
      ).rejects.toThrow();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('画像取得失敗時の契約', () => {
    /**
     * 「到達不能・無効な画像でも 200 + 空配列を返す」のが Vision の既存契約
     * (`shared/schemas/vision-api-extraction.ts`)。Gemini だけ throw に変えると
     * 呼び出し側のハルシネーション判定の前提が provider によって変わる。
     */
    it('取得できなかった画像は除外して続行する', async () => {
      global.fetch = jest.fn(async (url: unknown) =>
        String(url).includes('broken')
          ? { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
          : {
              ok: true,
              status: 200,
              headers: { get: () => 'image/jpeg' },
              arrayBuffer: async () => new TextEncoder().encode('ok').buffer,
            }
      ) as unknown as typeof fetch;

      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(
        callOptions({ imageUrls: [IMAGE_URL, 'https://example.com/broken.jpg'] })
      );

      const imageParts = lastRequest().contents[0].parts.filter((p) => 'inlineData' in p);
      expect(imageParts).toHaveLength(1);
    });

    it('全画像が取得できなくても throw せず空配列で返す', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('ENOTFOUND');
      }) as unknown as typeof fetch;
      mockGenerateContent.mockResolvedValue(
        buildResponse({ menuItems: [], goodsItems: [], noveltyItems: [] })
      );

      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      const result = await service.extractFromImages(callOptions());

      expect(result.visionExtraction.menuItems).toEqual([]);
      expect(result.visionExtraction.provider).toBe('google');
    });
  });

  describe('コストに直結する設定', () => {
    it('mediaResolution を config へ渡す', async () => {
      const service = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.mediaResolution).toBe(
        MediaResolution.MEDIA_RESOLUTION_MEDIUM
      );
    });

    it('mediaResolution 未指定なら LOW (既定が high 相当のため明示が必須)', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    });

    it('thinkingLevel を config へ渡す', async () => {
      const service = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        thinkingLevel: ThinkingLevel.MINIMAL,
      });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.MINIMAL);
    });

    /** 🔴 thinking は maxOutputTokens を共有するため余裕枠が要る */
    it('thinking が MINIMAL 以外なら maxOutputTokens に余裕枠を上乗せする', async () => {
      const minimal = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        thinkingLevel: ThinkingLevel.MINIMAL,
      });
      await minimal.extractFromImages(callOptions());
      const withoutHeadroom = lastRequest().config.maxOutputTokens ?? 0;

      const low = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        thinkingLevel: ThinkingLevel.LOW,
      });
      await low.extractFromImages(callOptions());
      const withHeadroom = lastRequest().config.maxOutputTokens ?? 0;

      expect(withHeadroom).toBeGreaterThan(withoutHeadroom);
    });

    /** 🔴 thinking トークンは出力として課金される */
    it('thinking トークンを tokensUsed.completionTokens に合算する', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse(MENU_PAYLOAD, { candidatesTokenCount: 120, thoughtsTokenCount: 80 })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      const result = await service.extractFromImages(callOptions());

      expect(result.visionExtraction.metadata?.tokensUsed?.completionTokens).toBe(200);
    });

    it('calculateTokens は mediaResolution 別の実測値で見積もる', async () => {
      const low = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      });
      const high = new GeminiVisionService({
        apiKey: DUMMY_API_KEY,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      });

      const lowResult = await low.calculateTokens([IMAGE_URL, IMAGE_URL]);
      const highResult = await high.calculateTokens([IMAGE_URL, IMAGE_URL]);

      expect(lowResult.provider).toBe('google');
      expect(lowResult.breakdown.imageTokens).toBe(252 * 2);
      expect(highResult.breakdown.imageTokens).toBe(1083 * 2);
      expect(highResult.estimatedCost).toBeGreaterThan(lowResult.estimatedCost);
    });
  });

  describe('切り詰め応答のガード', () => {
    it('finishReason=MAX_TOKENS は切り詰めとして throw する', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('{"menuItems":[{"name":"コラボ', { finishReason: 'MAX_TOKENS' })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      await expect(service.extractFromImages(callOptions())).rejects.toThrow(
        /truncated|MAX_TOKENS/
      );
    });

    /**
     * 🔴 切り詰めは `maxOutputTokens` と `thinkingLevel` という**固定設定**に起因する
     * 決定論的な失敗。同じ config で投げ直しても再現するため、リトライは
     * 1s/2s/4s のバックオフを挟んで 3 倍のトークンを捨てるだけになる。
     * ZodError と同じ fast-fail にすることを固定する。
     */
    it('切り詰めはリトライせず 1 回で諦める', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse('{"menuItems":[{"name":"コラボ', { finishReason: 'MAX_TOKENS' })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      await expect(service.extractFromImages(callOptions({ maxRetries: 3 }))).rejects.toThrow();
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    /**
     * コンテンツブロック系は `text` が undefined になりうる。空文字を正常な結果として
     * 返すと Vision の抽出が黙って空配列になる。
     */
    it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'])(
      'finishReason=%s も正常な結果として返さない',
      async (reason) => {
        mockGenerateContent.mockResolvedValue(buildResponse(undefined, { finishReason: reason }));
        const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

        await expect(service.extractFromImages(callOptions())).rejects.toThrow(
          new RegExp(reason)
        );
      }
    );

    /**
     * ブロック系の原因は**入力そのもの** (同じ画像・同じプロンプトなら大抵同じ判定)。
     * 切り詰めと同じく、リトライしてもトークンを捨てるだけになる。
     */
    it('ブロック系もリトライせず 1 回で諦める', async () => {
      mockGenerateContent.mockResolvedValue(buildResponse(undefined, { finishReason: 'SAFETY' }));
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      await expect(service.extractFromImages(callOptions({ maxRetries: 3 }))).rejects.toThrow();
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('スキーマ違反の扱い', () => {
    /**
     * ZodError は決定論的な契約違反なのでリトライしない (他 2 provider と同じ方針)。
     * リトライするとトークンを浪費したうえ、本当のバグの表面化が遅れる。
     */
    it('スキーマ違反はリトライせず即 throw する', async () => {
      // `name` 必須の MenuItem に対して数値を返す = 形が違う
      mockGenerateContent.mockResolvedValue(
        buildResponse({ menuItems: [{ price: 'not-a-number' }] })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      await expect(service.extractFromImages(callOptions({ maxRetries: 3 }))).rejects.toThrow();
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('抽出結果の変換', () => {
    it('provider = google で結果を返す', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      const result = await service.extractFromImages(callOptions());

      expect(result.visionExtraction.provider).toBe('google');
      expect(result.visionExtraction.menuItems[0]).toMatchObject({
        name: 'コラボパフェ',
        price: 1200,
        characterName: ['薬屋'],
      });
    });

    it('JSON mode を有効にして呼ぶ', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.responseMimeType).toBe('application/json');
    });
  });
});
