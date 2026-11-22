/**
 * @jest-environment node
 */
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

jest.mock('@/lib/env', () => ({ env: {} }));

import { GET, PUT } from '@/app/api/dev/review-photos/[...path]/route';
import { createFakePhotoStorage } from '@/lib/reviews/photos/storage';

const ROOT = path.join(os.tmpdir(), 'revolution-review-photos');
const KEY = `preview/reviews/1/route-test-${process.pid}`;
const params = (...segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

function put(body: Uint8Array, size: number, type = 'image/jpeg') {
  return PUT(
    new Request(`http://localhost/api/dev/review-photos/intake/${KEY}?size=${size}`, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: Buffer.from(body),
    }),
    params('intake', ...KEY.split('/'))
  );
}

describe('偽の写真の置き場所の route (開発用)', () => {
  // next/jest は .env.production.local も読む (手元では VERCEL_ENV が入る)。偽物を許す条件をここで決める
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.REVIEW_PHOTO_STORAGE = 'fake';
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'test';
  });
  afterEach(async () => {
    process.env = { ...saved };
    await rm(path.join(ROOT, 'intake', KEY), { force: true });
    await rm(path.join(ROOT, 'stored', KEY), { recursive: true, force: true });
  });

  it('上げた写真を受け取り場所に置く。大きさか形式が合わなければ 400', async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    expect((await put(body, 4)).status).toBe(200);
    await expect(createFakePhotoStorage().readIntake(KEY)).resolves.toEqual({ kind: 'ok', body });

    expect((await put(body, 5)).status).toBe(400);
    expect((await put(body, 4, 'image/gif')).status).toBe(400);
  });

  it('保管側の写真を返す。無い物・形式の分からない物は 404', async () => {
    await createFakePhotoStorage().putStored(`${KEY}/320.webp`, new Uint8Array([7]), 'image/webp');

    const found = await GET(
      new Request('http://localhost'),
      params('stored', ...`${KEY}/320.webp`.split('/'))
    );
    expect(found.status).toBe(200);
    expect(found.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await found.arrayBuffer())).toEqual(new Uint8Array([7]));

    const missing = await GET(
      new Request('http://localhost'),
      params('stored', ...`${KEY}/720.webp`.split('/'))
    );
    expect(missing.status).toBe(404);
  });

  it('偽物を使わない設定では、どちらも 404', async () => {
    process.env.REVIEW_PHOTO_STORAGE = '';
    expect((await put(new Uint8Array([1]), 1)).status).toBe(404);
    expect(
      (await GET(new Request('http://localhost'), params('stored', 'a', '320.webp'))).status
    ).toBe(404);
  });
});
