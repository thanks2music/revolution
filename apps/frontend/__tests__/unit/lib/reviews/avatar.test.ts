/**
 * @jest-environment node
 */
import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { avatarVariantKeys } from '@revolution/reviews/avatar/operations';
import { loadAvatarScreeningPrompt } from '@revolution/reviews/avatar/prompt';
import {
  createFakeAvatarScreener,
  createGeminiAvatarScreener,
} from '@revolution/reviews/avatar/screener';
import { toAvatarView } from '@revolution/reviews/avatar/view';
import { convertSquareImage } from '@revolution/reviews/photos/convert';

/** プロフィール画像 (one-more-time #171) の Layer 1 (変換・形) と Layer 2 (審査器の口) */

const PROMPT = { version: 1, model: 'test-model', system: 's', user: '審査してください' };
const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

function image(color: { r: number; g: number; b: number }, width = 300, height = 200) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

describe('convertSquareImage', () => {
  it('真ん中を正方形に切り抜き、各段を WebP と AVIF で作る (小さい画像は拡大する)', async () => {
    const result = await convertSquareImage(
      await image({ r: 10, g: 20, b: 30 }, 100, 60),
      [64, 128, 256]
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.variants.map(v => `${v.width}.${v.format}`)).toEqual([
      '64.webp',
      '64.avif',
      '128.webp',
      '128.avif',
      '256.webp',
      '256.avif',
    ]);
    const largest = result.variants.find(v => v.width === 256 && v.format === 'webp')!;
    expect(await sharp(largest.body).metadata()).toMatchObject({ width: 256, height: 256 });
  });

  it('画像でない物は断る', async () => {
    expect(await convertSquareImage(Buffer.from('hello'), [64])).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('avatar のキーと表示の形', () => {
  it('3 段 × 2 形式のキーと、配信側の srcset', () => {
    expect(avatarVariantKeys('preview/profiles/p/i')).toHaveLength(6);
    expect(toAvatarView('https://img.example.test', 'preview/profiles/p/i')).toEqual({
      avifSrcSet:
        'https://img.example.test/preview/profiles/p/i/64.avif 64w, https://img.example.test/preview/profiles/p/i/128.avif 128w, https://img.example.test/preview/profiles/p/i/256.avif 256w',
      webpSrcSet:
        'https://img.example.test/preview/profiles/p/i/64.webp 64w, https://img.example.test/preview/profiles/p/i/128.webp 128w, https://img.example.test/preview/profiles/p/i/256.webp 256w',
      src: 'https://img.example.test/preview/profiles/p/i/256.webp',
    });
  });
});

describe('createGeminiAvatarScreener', () => {
  const imageInput = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/webp' };
  const responding = (text: string, finishReason = 'STOP') =>
    jest.fn(async () => ({ text, candidates: [{ finishReason }] }) as never);

  it('通す・落とすを返し、画像を 1 枚だけ渡す', async () => {
    const models = {
      generateContent: responding(
        JSON.stringify({ decision: 'reject', reason_code: 'sexual_or_violent', reason: 'x' })
      ),
    };
    const screener = createGeminiAvatarScreener({ models, prompt: PROMPT });
    expect(await screener.screen(imageInput)).toEqual({
      ok: true,
      decision: 'reject',
      model: 'test-model',
    });
    const params = (models.generateContent.mock.calls as unknown[][])[0][0] as {
      contents: { parts: unknown[] }[];
    };
    expect(params.contents[0].parts).toEqual([
      { text: '審査してください' },
      { inlineData: { mimeType: 'image/webp', data: Buffer.from([1, 2, 3]).toString('base64') } },
    ]);
  });

  it('形の崩れ・打ち切り・API の失敗は ok: false (やり直しの末)', async () => {
    for (const models of [
      { generateContent: responding('{"decision":"reject","reason_code":null,"reason":"x"}') },
      { generateContent: responding('{}', 'SAFETY') },
      {
        generateContent: jest.fn(async () => {
          throw Object.assign(new Error('boom'), { status: 503 });
        }),
      },
    ]) {
      const screener = createGeminiAvatarScreener({
        models: models as never,
        prompt: PROMPT,
        retry: { delays: [0, 0] },
      });
      expect(await screener.screen(imageInput)).toMatchObject({ ok: false, model: 'test-model' });
    }
  });
});

describe('createFakeAvatarScreener', () => {
  const screener = createFakeAvatarScreener();
  it.each([
    [
      { r: 255, g: 0, b: 0 },
      { ok: true, decision: 'reject' },
    ],
    [{ r: 0, g: 0, b: 255 }, { ok: false }],
    [
      { r: 20, g: 200, b: 20 },
      { ok: true, decision: 'ok' },
    ],
  ])('左上の色 %o → %o', async (color, expected) => {
    expect(
      await screener.screen({ data: await image(color), mimeType: 'image/png' })
    ).toMatchObject(expected);
  });
});

describe('loadAvatarScreeningPrompt', () => {
  async function dirWith(yaml: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'avatar-prompt-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'reviews'));
    await writeFile(path.join(dir, 'reviews', 'avatar-screening.yaml'), yaml);
    return dir;
  }

  it('形が正しければ読む。user にプレースホルダーがあれば断る', async () => {
    await expect(
      loadAvatarScreeningPrompt(await dirWith('version: 1\nmodel: m\nsystem: s\nuser: u\n'))
    ).resolves.toMatchObject({ version: 1, model: 'm' });
    await expect(
      loadAvatarScreeningPrompt(
        await dirWith('version: 1\nmodel: m\nsystem: s\nuser: "{{body}}"\n')
      )
    ).rejects.toThrow();
  });
});
