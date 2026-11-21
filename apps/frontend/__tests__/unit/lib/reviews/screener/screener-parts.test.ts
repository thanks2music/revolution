import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, jest } from '@jest/globals';

import { createFakeScreener, FAKE_SCREENER_MODEL } from '@/lib/reviews/screener/fake-screener';
import { getReviewScreener } from '@/lib/reviews/screener';
import { loadScreeningPrompt } from '@/lib/reviews/screener/prompt';
import { ReviewScreeningResponseSchema } from '@revolution/schemas/review-screening-response';
import { isTransientError, withTransientRetry } from '@/lib/reviews/screener/retry';

const VALID = 'version: 1\nmodel: m\nsystem: s\nuser: "<review>{{body}}</review>"\n';
const NO_BODY = 'version: 1\nmodel: m\nsystem: s\nuser: "本文なし"\n';

// テストで作った一時ディレクトリ (最後に消す)
const tempDirs: string[] = [];
async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

/** reviews/screening.yaml を置いた templates のディレクトリ */
async function templatesWith(yaml: string) {
  const dir = await tempDir('templates-');
  await mkdir(path.join(dir, 'reviews'));
  await writeFile(path.join(dir, 'reviews', 'screening.yaml'), yaml);
  return dir;
}

describe('isTransientError', () => {
  it.each([
    [{ status: 429 }, true],
    [{ status: 500 }, true],
    [{ status: 503 }, true],
    [{ status: 400 }, false],
    [{ status: 403 }, false],
    [new DOMException('timeout', 'TimeoutError'), true],
    [new TypeError('fetch failed'), true],
    [new TypeError('x', { cause: { code: 'ECONNRESET' } }), true],
    [new TypeError("Cannot read properties of undefined (reading 'text')"), false],
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

    await expect(withTransientRetry(fn, { delays: [10, 20], sleep })).rejects.toMatchObject({
      status: 503,
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([10, 20]);
  });

  it('一時的なエラーの後に通れば、その値を返す', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }))
      .mockResolvedValueOnce('ok');

    await expect(withTransientRetry(fn, { sleep: async () => {} })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('createFakeScreener', () => {
  const screener = createFakeScreener();

  it.each([
    ['楽しかった', { ok: true, decision: 'publish', reasonCode: null }],
    ['[reject:spam] 宣伝', { ok: true, decision: 'reject', reasonCode: 'spam' }],
    ['[unsure] どうだろう', { ok: true, decision: 'unsure', reasonCode: null }],
    ['[fail]', { ok: false }],
    ['[reject:typo] 書き間違い', { ok: false }],
  ])('%s', async (body, expected) => {
    await expect(screener.screen({ body })).resolves.toMatchObject({
      ...expected,
      model: FAKE_SCREENER_MODEL,
    });
  });
});

describe('loadScreeningPrompt', () => {
  it('YAML を読んで形を確かめる', async () => {
    const dir = await templatesWith(VALID);

    await expect(loadScreeningPrompt(dir)).resolves.toEqual({
      version: 1,
      model: 'm',
      system: 's',
      user: '<review>{{body}}</review>',
    });
  });

  it('{{body}} の無いプロンプトは拒否する', async () => {
    await expect(loadScreeningPrompt(await templatesWith(NO_BODY))).rejects.toThrow();
  });

  it('本文を <review> タグで囲まないプロンプトは拒否する (全角への置き換えが効かなくなるため)', async () => {
    const dir = await templatesWith('version: 1\nmodel: m\nsystem: s\nuser: "[[{{body}}]]"\n');

    await expect(loadScreeningPrompt(dir)).rejects.toThrow();
  });
});

describe('getReviewScreener', () => {
  it.each(['development', 'test'])(
    'NODE_ENV=%s で REVIEW_SCREENER=fake なら偽物を使う',
    async nodeEnv => {
      const screener = await getReviewScreener({ REVIEW_SCREENER: 'fake', NODE_ENV: nodeEnv });

      await expect(screener.screen({ body: 'x' })).resolves.toMatchObject({
        model: FAKE_SCREENER_MODEL,
      });
    }
  );

  it('ビルドした物 (NODE_ENV=production。Vercel の Preview を含む) では REVIEW_SCREENER=fake を無視する', async () => {
    const screener = await getReviewScreener({
      REVIEW_SCREENER: 'fake',
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
    });

    await expect(screener.screen({ body: 'x' })).resolves.toMatchObject({ ok: false, model: null });
  });

  it('本番では REVIEW_SCREENER=fake を無視する (鍵が無いので必ず失敗し、公開されない)', async () => {
    const screener = await getReviewScreener({
      REVIEW_SCREENER: 'fake',
      NODE_ENV: 'test',
      VERCEL_ENV: 'production',
    });

    await expect(screener.screen({ body: 'x' })).resolves.toEqual({
      ok: false,
      error: 'GEMINI_API_KEY is not set',
      model: null,
    });
  });

  it('鍵はあってもプロンプトが読めなければ、必ず失敗する審査器にする', async () => {
    // 空の置き場所を渡す (手元に取り込んだプロンプトがあっても、本物の API を呼ばないように)
    const emptyDir = await tempDir('no-templates-');
    const screener = await getReviewScreener(
      { GEMINI_API_KEY: 'test-key' },
      { templatesDir: emptyDir }
    );

    await expect(screener.screen({ body: 'x' })).resolves.toEqual({
      ok: false,
      error: 'screening prompt is missing or invalid',
      model: null,
    });
  });
});

describe('ReviewScreeningResponseSchema', () => {
  it('reject には理由のコードが要る', () => {
    expect(
      ReviewScreeningResponseSchema.safeParse({
        decision: 'reject',
        reason_code: null,
        reason: 'x',
      }).success
    ).toBe(false);
  });

  it('長い説明でも判定は受け付ける (切るのは保存する側)', () => {
    expect(
      ReviewScreeningResponseSchema.safeParse({
        decision: 'publish',
        reason_code: null,
        reason: 'あ'.repeat(2000),
      }).success
    ).toBe(true);
  });
});

/**
 * 取り込みのスクリプト (scripts/fetch-templates.sh)。本番のビルドを止めるかどうかを決める所なので、
 * 本番と本番以外の分かれ目を確かめる。置き先は一時ディレクトリにする (TEMPLATES_DEST)
 */
describe('fetch-templates.sh', () => {
  async function run(env: Record<string, string>) {
    const dest = await tempDir('fetched-');
    const result = await new Promise<{ code: number; stderr: string }>(resolve => {
      execFile(
        'bash',
        ['scripts/fetch-templates.sh'],
        {
          // 手元の env (VERCEL_ENV・TEMPLATES_* など) を持ち込まないよう、必要な物だけを渡す
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TEMPLATES_DEST: dest,
            ...env,
          } as unknown as NodeJS.ProcessEnv,
        },
        (error, _stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stderr })
      );
    });
    return { ...result, dest };
  }

  it('手元の templates repo から取り込む', async () => {
    const { code, dest } = await run({ TEMPLATES_SOURCE_PATH: await templatesWith(VALID) });

    expect(code).toBe(0);
    await expect(readFile(path.join(dest, 'reviews', 'screening.yaml'), 'utf8')).resolves.toBe(
      VALID
    );
  }, 60_000);

  it('取り込み元が無ければ、本番では止め、本番以外では警告して続ける', async () => {
    expect((await run({ VERCEL_ENV: 'production' })).code).toBe(1);
    const preview = await run({ VERCEL_ENV: 'preview' });
    expect(preview.code).toBe(0);
    expect(preview.stderr).toContain('warning');
  }, 60_000);

  it('形の崩れたプロンプトは、本番では止め、置き先に入れない', async () => {
    const source = await templatesWith(NO_BODY);

    const production = await run({ TEMPLATES_SOURCE_PATH: source, VERCEL_ENV: 'production' });
    expect(production.code).toBe(1);
    await expect(
      readFile(path.join(production.dest, 'reviews', 'screening.yaml'))
    ).rejects.toThrow();
  }, 60_000);
});
