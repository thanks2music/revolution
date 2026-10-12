/**
 * Layer 2 contract tests for GeminiVisionService.
 *
 * ⚠️ **本ファイルの最重要ケースは「画像を inlineData で送ること」である。**
 * Gemini は `fileData.fileUri` に公開 HTTPS URL を渡すと **429 RESOURCE_EXHAUSTED が
 * 恒常的に返る** (2026-08-16 に 2 回実測。直後の inlineData 呼び出しは成功するので
 * アカウントの quota ではない)。画像は `prepareVisionImages` が取得・分割した base64 を
 * 受け取る (2026-10-12 から 3 社共通。取得と分割のテストは prepare-vision-images.test.ts)。
 * ここが URL 直渡しに戻ると全 Vision 呼び出しが 429 で落ちる。
 *
 * あわせて以下も固定する:
 * - `mediaResolution` / `thinkingLevel` が config へ渡ること (どちらもコスト直結)
 * - thinking トークンを出力として計上すること
 * - 切り詰め応答 (`MAX_TOKENS`) を正常な結果として返さないこと
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

function callOptions(overrides: Record<string, unknown> = {}) {
  return {
    images: [{ source: IMAGE_URL, data: 'aW1n', mimeType: 'image/jpeg' }],
    prompt: 'メニューを抽出してください',
    category: 'menu' as const,
    maxRetries: 1,
    ...overrides,
  };
}

describe('GeminiVisionService', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue(buildResponse(MENU_PAYLOAD));
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      expect(imageParts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'aW1n' });
      expect(parts.some((p) => 'fileData' in p)).toBe(false);
    });

    it('プロンプトは呼び出し元から渡されたものをそのまま先頭に置く', async () => {
      // プロンプトは Templates の YAML が真実源。service 側で組み立てない (SoC)。
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions({ prompt: 'ノベルティを抽出' }));

      expect(lastRequest().contents[0].parts[0]).toEqual({ text: 'ノベルティを抽出' });
    });

    it('画像が複数 (分割した片) なら、渡された順に並べる', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(
        callOptions({
          images: [
            { source: `${IMAGE_URL}#slice=1/2`, data: 'MQ==', mimeType: 'image/jpeg' },
            { source: `${IMAGE_URL}#slice=2/2`, data: 'Mg==', mimeType: 'image/jpeg' },
          ],
        })
      );

      const data = lastRequest()
        .contents[0].parts.filter((p) => 'inlineData' in p)
        .map((p) => (p.inlineData as { data: string }).data);
      expect(data).toEqual(['MQ==', 'Mg==']);
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

    it('mediaResolution 未指定なら HIGH (品名の小さな文字を読むため。2026-10-12 に LOW から変更)', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_HIGH);
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
    it('name の無い品目や数値でない価格は、捨てる・値なしにして通す (リトライしない)', async () => {
      // 2026-10-11: 変換を normalizeVisionResponse にまとめ、形の崩れで失敗させないようにした
      mockGenerateContent.mockResolvedValue(
        buildResponse({ menuItems: [{ price: 'not-a-number' }, { name: 'パフェ', price: 'not-a-number' }] })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });

      const result = await service.extractFromImages(callOptions({ maxRetries: 3 }));

      expect(result.visionExtraction.menuItems).toHaveLength(1);
      expect(result.visionExtraction.menuItems[0]).toMatchObject({ name: 'パフェ', price: undefined });
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

    // 2026-10-10 heroaca-cafe の実測: description が null の品目が 1 つでもあると
    // ZodError でメニュー 20 品以上がまとめて 0 品になっていた
    it('文字列フィールドの null は値なしとして扱い、品目を落とさない', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse({
          menuItems: [
            { name: 'デクのオムライス', price: 1890, characterName: [], description: null, notes: null },
          ],
          goodsItems: [{ name: '缶バッジ', characterName: [], variantDetails: null }],
          noveltyItems: [{ name: 'ランチョンマット', characterName: [], condition: null, remarks: null }],
        })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      const { visionExtraction } = await service.extractFromImages(callOptions());

      expect(visionExtraction.menuItems).toHaveLength(1);
      expect(visionExtraction.menuItems[0].description).toBeUndefined();
      expect(visionExtraction.goodsItems[0].variantDetails).toBeUndefined();
      expect(visionExtraction.noveltyItems[0].condition).toBeUndefined();
    });

    it('文字列フィールドに文字列以外が来たら値なしとして扱い、品目は残す', async () => {
      mockGenerateContent.mockResolvedValue(
        buildResponse({
          menuItems: [{ name: 'デクのオムライス', price: 1890, characterName: [], description: 123 }],
        })
      );
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      const { visionExtraction } = await service.extractFromImages(callOptions());

      expect(visionExtraction.menuItems).toHaveLength(1);
      expect(visionExtraction.menuItems[0].description).toBeUndefined();
    });

    it('JSON mode を有効にして呼ぶ', async () => {
      const service = new GeminiVisionService({ apiKey: DUMMY_API_KEY });
      await service.extractFromImages(callOptions());

      expect(lastRequest().config.responseMimeType).toBe('application/json');
    });
  });
});
