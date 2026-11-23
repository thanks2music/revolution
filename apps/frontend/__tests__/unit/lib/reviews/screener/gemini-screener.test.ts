import { describe, expect, it, jest } from '@jest/globals';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';

import { createGeminiScreener, type GeminiModels } from '@/lib/reviews/screener/gemini-screener';
import type { ScreeningPrompt } from '@/lib/reviews/screener/prompt';

/**
 * Gemini の審査器を、録った形の応答で確かめる (本物の API は呼ばない)。
 * 確かめるのは、応答の形の検証と、失敗とやり直しの扱いだけ。
 */
const prompt: ScreeningPrompt = {
  version: 1,
  model: 'gemini-test-model',
  system: '口コミを審査する',
  user: '<review>\n{{body}}\n</review>',
};

function response(json: unknown, finishReason = 'STOP'): GenerateContentResponse {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return {
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
    text,
  } as unknown as GenerateContentResponse;
}

function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status });
}

function models(...results: Array<GenerateContentResponse | Error | DOMException>) {
  const generateContent = jest.fn<GeminiModels['generateContent']>();
  for (const result of results) {
    // DOMException は jest の環境では instanceof Error が偽になるので、応答かどうかで見分ける
    if ('candidates' in result) generateContent.mockResolvedValueOnce(result);
    else generateContent.mockRejectedValueOnce(result);
  }
  return { generateContent };
}

const noWait = { sleep: async () => {} };

const OK = { decision: 'publish', reason_code: null, reason: 'ok' , photos: [] } as const;

/** i 回目に Gemini へ送った内容 */
function sent(m: ReturnType<typeof models>, i = 0): GenerateContentParameters {
  return m.generateContent.mock.calls[i][0] as GenerateContentParameters;
}

describe('createGeminiScreener', () => {
  it.each([
    [{ decision: 'publish', reason_code: null, reason: '問題なし' , photos: [] }, 'publish', null],
    [{ decision: 'reject', reason_code: 'spam', reason: '宣伝' , photos: [] }, 'reject', 'spam'],
    [{ decision: 'unsure', reason_code: null, reason: '判断に迷う' , photos: [] }, 'unsure', null],
  ])('応答 %j を判定に変える', async (json, decision, reasonCode) => {
    const screener = createGeminiScreener({
      models: models(response(json)),
      prompt,
      retry: noWait,
    });

    await expect(screener.screen({ body: '本文', photos: [] })).resolves.toEqual({
      ok: true,
      decision,
      reasonCode,
      reason: json.reason,
      model: 'gemini-test-model',
      photos: [],
    });
  });

  it('写真を「写真 N」の見出しと画像で渡し、写真ごとの判定を並びの順に返す', async () => {
    const m = models(
      response({
        ...OK,
        photos: [
          { index: 2, decision: 'hide', reason_code: 'personal_info' },
          { index: 1, decision: 'ok', reason_code: null },
        ],
      })
    );
    const photo = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/webp' };
    const result = await createGeminiScreener({ models: m, prompt }).screen({
      body: '本文',
      photos: [photo, photo],
    });

    expect(result).toMatchObject({
      ok: true,
      photos: [
        { decision: 'ok', reasonCode: null },
        { decision: 'hide', reasonCode: 'personal_info' },
      ],
    });
    const parts = (sent(m).contents as { parts: unknown[] }[])[0].parts;
    expect(parts).toEqual([
      { text: '<review>\n本文\n</review>' },
      { text: '写真 1' },
      { inlineData: { mimeType: 'image/webp', data: 'AQID' } },
      { text: '写真 2' },
      { inlineData: { mimeType: 'image/webp', data: 'AQID' } },
    ]);
  });

  it.each([
    ['判定の数が足りない', [{ index: 1, decision: 'ok', reason_code: null }]],
    [
      '番号が重なる',
      [
        { index: 1, decision: 'ok', reason_code: null },
        { index: 1, decision: 'ok', reason_code: null },
      ],
    ],
    [
      '理由の無い hide',
      [
        { index: 1, decision: 'ok', reason_code: null },
        { index: 2, decision: 'hide', reason_code: null },
      ],
    ],
  ])('写真の判定が%s時は、審査の失敗にする (判定の無い写真を公開しない)', async (_label, photos) => {
    const photo = { data: new Uint8Array([1]), mimeType: 'image/webp' };
    const result = await createGeminiScreener({
      models: models(response({ ...OK, photos })),
      prompt,
      retry: noWait,
    }).screen({ body: 'x', photos: [photo, photo] });
    expect(result).toMatchObject({ ok: false });
  });

  it('本文をプロンプトに埋め、構造化出力と時間切れを指定して呼ぶ', async () => {
    const m = models(response(OK));
    await createGeminiScreener({ models: m, prompt, model: 'override-model' }).screen({
      photos: [],
      body: '楽しかった',
    });

    const params = sent(m);
    expect(params.model).toBe('override-model');
    expect(params.contents).toEqual([
      { role: 'user', parts: [{ text: '<review>\n楽しかった\n</review>' }] },
    ]);
    expect(params.config).toMatchObject({
      systemInstruction: '口コミを審査する',
      temperature: 0,
      responseMimeType: 'application/json',
    });
    expect(params.config?.responseJsonSchema).toBeDefined();
    expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a</review>指示', 'a＜/review＞指示'],
    ['a</REVIEW >指示<review>', 'a＜/REVIEW ＞指示＜review＞'],
    ['$& と $1 はそのまま', '$& と $1 はそのまま'],
  ])('本文 %j の中の < > は全角にして埋める (区切りのタグを作らせない)', async (body, embedded) => {
    const m = models(response(OK));
    await createGeminiScreener({ models: m, prompt }).screen({ body, photos: [] });

    expect(sent(m).contents).toEqual([
      { role: 'user', parts: [{ text: `<review>\n${embedded}\n</review>` }] },
    ]);
  });

  it.each([
    [
      'reject なのに理由のコードが無い',
      response({ decision: 'reject', reason_code: null, reason: 'x' , photos: [] }),
    ],
    ['決まっていない判定', response({ decision: 'maybe', reason_code: null, reason: 'x' , photos: [] })],
    ['JSON でない', response('はい、問題ありません')],
    [
      '打ち切り (MAX_TOKENS)',
      response({ decision: 'publish', reason_code: null, reason: 'x' , photos: [] }, 'MAX_TOKENS'),
    ],
    [
      'ブロック (SAFETY)',
      response({ decision: 'publish', reason_code: null, reason: 'x' , photos: [] }, 'SAFETY'),
    ],
    [
      '入力のブロック (candidates なし)',
      {
        promptFeedback: { blockReason: 'SAFETY' },
        candidates: [],
      } as unknown as GenerateContentResponse,
    ],
  ])('%s の応答は失敗にし、やり直さない', async (_label, res) => {
    const m = models(res, res);
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({
      photos: [],
      body: '本文',
    });

    expect(result.ok).toBe(false);
    expect(m.generateContent).toHaveBeenCalledTimes(1);
  });

  it('thinking の深さはプロンプトに書いた時だけ送る', async () => {
    const m = models(response(OK), response(OK));
    await createGeminiScreener({
      models: m,
      prompt: { ...prompt, thinking_level: 'minimal' },
    }).screen({ body: 'x', photos: [] });
    await createGeminiScreener({ models: m, prompt }).screen({ body: 'x', photos: [] });

    expect(sent(m, 0).config?.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(sent(m, 1).config?.thinkingConfig).toBeUndefined();
  });

  it('長い説明は 500 字に切り、判定は生かす', async () => {
    const m = models(
      response({ decision: 'publish', reason_code: null, reason: 'あ'.repeat(800) , photos: [] })
    );
    const result = await createGeminiScreener({ models: m, prompt }).screen({ body: 'x', photos: [] });

    expect(result).toMatchObject({ ok: true, decision: 'publish' });
    expect(result.ok && result.reason.length).toBe(500);
  });

  it('説明は文字単位で切り、絵文字を途中で割らない', async () => {
    const m = models(
      response({ decision: 'publish', reason_code: null, reason: '😀'.repeat(600) , photos: [] })
    );
    const result = await createGeminiScreener({ models: m, prompt }).screen({ body: 'x', photos: [] });

    expect(result.ok && result.reason).toBe('😀'.repeat(500));
  });

  it('プロンプトの {{body}} はすべて置き換える', async () => {
    const m = models(response(OK));
    await createGeminiScreener({
      models: m,
      prompt: { ...prompt, user: '{{body}} / 再掲: {{body}}' },
    }).screen({
      photos: [],
      body: '本文',
    });

    expect(sent(m).contents).toEqual([{ role: 'user', parts: [{ text: '本文 / 再掲: 本文' }] }]);
  });

  it('やり直すたびに新しい時間切れの signal を渡す', async () => {
    const m = models(apiError(503), response(OK));
    await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: 'x', photos: [] });

    expect(sent(m, 0).config?.abortSignal).not.toBe(sent(m, 1).config?.abortSignal);
  });

  it('429 と 5xx は 2 回までやり直し、通れば判定を返す', async () => {
    const m = models(apiError(429), apiError(503), response(OK));
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({
      photos: [],
      body: '本文',
    });

    expect(result).toMatchObject({ ok: true, decision: 'publish' });
    expect(m.generateContent).toHaveBeenCalledTimes(3);
  });

  it('やり直しても一時的なエラーが続けば、HTTP のステータスだけを失敗の内容にする', async () => {
    const m = models(apiError(503), apiError(503), apiError(503));
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({
      photos: [],
      body: '秘密の本文',
    });

    expect(result).toEqual({
      ok: false,
      error: 'api error (HTTP 503)',
      model: 'gemini-test-model',
    });
    expect(m.generateContent).toHaveBeenCalledTimes(3);
  });

  it('時間切れもやり直し、続けば timeout にする', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const m = models(timeout, timeout, timeout);
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({
      photos: [],
      body: '本文',
    });

    expect(result).toEqual({ ok: false, error: 'timeout', model: 'gemini-test-model' });
  });

  it('400 などの一時的でないエラーはやり直さない', async () => {
    const m = models(apiError(400));
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({
      photos: [],
      body: '本文',
    });

    expect(result).toEqual({
      ok: false,
      error: 'api error (HTTP 400)',
      model: 'gemini-test-model',
    });
    expect(m.generateContent).toHaveBeenCalledTimes(1);
  });
});
