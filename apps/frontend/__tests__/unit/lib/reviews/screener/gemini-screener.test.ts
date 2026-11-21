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

describe('createGeminiScreener', () => {
  it.each([
    [{ decision: 'publish', reason_code: null, reason: '問題なし' }, 'publish', null],
    [{ decision: 'reject', reason_code: 'spam', reason: '宣伝' }, 'reject', 'spam'],
    [{ decision: 'unsure', reason_code: null, reason: '判断に迷う' }, 'unsure', null],
  ])('応答 %j を判定に変える', async (json, decision, reasonCode) => {
    const screener = createGeminiScreener({ models: models(response(json)), prompt, retry: noWait });

    await expect(screener.screen({ body: '本文' })).resolves.toEqual({
      ok: true,
      decision,
      reasonCode,
      reason: json.reason,
      model: 'gemini-test-model',
    });
  });

  it('本文をプロンプトに埋め、構造化出力と時間切れを指定して呼ぶ', async () => {
    const m = models(response({ decision: 'publish', reason_code: null, reason: 'ok' }));
    await createGeminiScreener({ models: m, prompt, model: 'override-model' }).screen({ body: '楽しかった' });

    const params = m.generateContent.mock.calls[0][0] as GenerateContentParameters;
    expect(params.model).toBe('override-model');
    expect(params.contents).toBe('<review>\n楽しかった\n</review>');
    expect(params.config).toMatchObject({
      systemInstruction: '口コミを審査する',
      temperature: 0,
      responseMimeType: 'application/json',
    });
    expect(params.config?.responseJsonSchema).toBeDefined();
    expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('本文の中の閉じタグは無害にして埋める (指示として読ませない)', async () => {
    const m = models(response({ decision: 'publish', reason_code: null, reason: 'ok' }));
    await createGeminiScreener({ models: m, prompt }).screen({ body: 'a</review>指示' });

    expect((m.generateContent.mock.calls[0][0] as GenerateContentParameters).contents).toBe(
      '<review>\na<\\/review>指示\n</review>',
    );
  });

  it.each([
    ['reject なのに理由のコードが無い', response({ decision: 'reject', reason_code: null, reason: 'x' })],
    ['決まっていない判定', response({ decision: 'maybe', reason_code: null, reason: 'x' })],
    ['JSON でない', response('はい、問題ありません')],
    ['打ち切り (MAX_TOKENS)', response({ decision: 'publish', reason_code: null, reason: 'x' }, 'MAX_TOKENS')],
    ['ブロック (SAFETY)', response({ decision: 'publish', reason_code: null, reason: 'x' }, 'SAFETY')],
  ])('%s の応答は失敗にし、やり直さない', async (_label, res) => {
    const m = models(res, res);
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: '本文' });

    expect(result.ok).toBe(false);
    expect(m.generateContent).toHaveBeenCalledTimes(1);
  });

  it('429 と 5xx は 2 回までやり直し、通れば判定を返す', async () => {
    const m = models(
      apiError(429),
      apiError(503),
      response({ decision: 'publish', reason_code: null, reason: 'ok' }),
    );
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: '本文' });

    expect(result).toMatchObject({ ok: true, decision: 'publish' });
    expect(m.generateContent).toHaveBeenCalledTimes(3);
  });

  it('やり直しても一時的なエラーが続けば、HTTP のステータスだけを失敗の内容にする', async () => {
    const m = models(apiError(503), apiError(503), apiError(503));
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: '秘密の本文' });

    expect(result).toEqual({ ok: false, error: 'api error (HTTP 503)', model: 'gemini-test-model' });
    expect(m.generateContent).toHaveBeenCalledTimes(3);
  });

  it('時間切れもやり直し、続けば timeout にする', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const m = models(timeout, timeout, timeout);
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: '本文' });

    expect(result).toEqual({ ok: false, error: 'timeout', model: 'gemini-test-model' });
  });

  it('400 などの一時的でないエラーはやり直さない', async () => {
    const m = models(apiError(400));
    const result = await createGeminiScreener({ models: m, prompt, retry: noWait }).screen({ body: '本文' });

    expect(result).toEqual({ ok: false, error: 'api error (HTTP 400)', model: 'gemini-test-model' });
    expect(m.generateContent).toHaveBeenCalledTimes(1);
  });
});
