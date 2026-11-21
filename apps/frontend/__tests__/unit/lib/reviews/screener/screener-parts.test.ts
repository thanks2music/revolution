import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import { createFakeScreener, FAKE_SCREENER_MODEL } from '@/lib/reviews/screener/fake-screener';
import { getReviewScreener } from '@/lib/reviews/screener';
import { loadScreeningPrompt } from '@/lib/reviews/screener/prompt';
import { isTransientError, withTransientRetry } from '@/lib/reviews/screener/retry';

describe('isTransientError', () => {
  it.each([
    [{ status: 429 }, true],
    [{ status: 500 }, true],
    [{ status: 503 }, true],
    [{ status: 400 }, false],
    [{ status: 403 }, false],
    [new DOMException('timeout', 'TimeoutError'), true],
    [new TypeError('fetch failed'), true],
    [new Error('x'), false],
    ['text', false],
  ])('%p → %p', (error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});

describe('withTransientRetry', () => {
  it('間隔を空けて、決めた回数だけやり直す', async () => {
    const sleep = jest.fn(async (_ms: number) => {});
    const fn = jest.fn(async () => {
      throw Object.assign(new Error('x'), { status: 503 });
    });

    await expect(withTransientRetry(fn, { delays: [10, 20], sleep })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([10, 20]);
  });

  it('何回目で通ったかを返す', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('x'), { status: 429 });
      return 'ok';
    };

    await expect(withTransientRetry(fn, { sleep: async () => {} })).resolves.toEqual({ value: 'ok', attempts: 2 });
  });
});

describe('createFakeScreener', () => {
  const screener = createFakeScreener();

  it.each([
    ['楽しかった', { ok: true, decision: 'publish', reasonCode: null }],
    ['[reject:spam] 宣伝', { ok: true, decision: 'reject', reasonCode: 'spam' }],
    ['[unsure] どうだろう', { ok: true, decision: 'unsure', reasonCode: null }],
    ['[fail]', { ok: false }],
  ])('%s', async (body, expected) => {
    await expect(screener.screen({ body })).resolves.toMatchObject({ ...expected, model: FAKE_SCREENER_MODEL });
  });
});

describe('loadScreeningPrompt', () => {
  async function dirWith(yaml: string) {
    const dir = await mkdtemp(path.join(tmpdir(), 'screening-'));
    await mkdir(path.join(dir, 'reviews'));
    await writeFile(path.join(dir, 'reviews', 'screening.yaml'), yaml);
    return dir;
  }

  it('YAML を読んで形を確かめる', async () => {
    const dir = await dirWith('version: 1\nmodel: m\nsystem: s\nuser: "<review>{{body}}</review>"\n');

    await expect(loadScreeningPrompt(dir)).resolves.toEqual({
      version: 1,
      model: 'm',
      system: 's',
      user: '<review>{{body}}</review>',
    });
  });

  it('{{body}} の無いプロンプトは拒否する', async () => {
    const dir = await dirWith('version: 1\nmodel: m\nsystem: s\nuser: "本文なし"\n');

    await expect(loadScreeningPrompt(dir)).rejects.toThrow();
  });
});

describe('getReviewScreener', () => {
  it('本番以外で REVIEW_SCREENER=fake なら偽物を使う', async () => {
    const screener = await getReviewScreener({ REVIEW_SCREENER: 'fake' });

    await expect(screener.screen({ body: 'x' })).resolves.toMatchObject({ model: FAKE_SCREENER_MODEL });
  });

  it('本番では REVIEW_SCREENER=fake を無視する (鍵が無いので必ず失敗し、公開されない)', async () => {
    const screener = await getReviewScreener({ REVIEW_SCREENER: 'fake', VERCEL_ENV: 'production' });

    await expect(screener.screen({ body: 'x' })).resolves.toEqual({
      ok: false,
      error: 'GEMINI_API_KEY is not set',
      model: null,
    });
  });

  it('鍵はあってもプロンプトが読めなければ、必ず失敗する審査器にする', async () => {
    // 空の置き場所を渡す (手元に取り込んだプロンプトがあっても、本物の API を呼ばないように)
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'no-templates-'));
    const screener = await getReviewScreener({ GEMINI_API_KEY: 'test-key' }, { templatesDir: emptyDir });

    await expect(screener.screen({ body: 'x' })).resolves.toEqual({
      ok: false,
      error: 'screening prompt is missing or invalid',
      model: null,
    });
  });
});
