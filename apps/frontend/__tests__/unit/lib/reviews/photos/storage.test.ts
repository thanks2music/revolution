/**
 * @jest-environment node
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import {
  createFakePhotoStorage,
  createR2Client,
  createR2PhotoStorage,
  getReviewPhotoStorage,
  reviewPhotoKeyPrefix,
  storedVariantKey,
} from '@/lib/reviews/photos/storage';

const CONFIG = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-example',
  intakeBucket: 'intake-bucket',
  photoBucket: 'photo-bucket',
  publicBucket: 'public-bucket',
  publicBaseUrl: 'https://img.example.test',
};

function r2WithFakeSend() {
  const client = createR2Client(CONFIG);
  // send は命令ごとに型が分かれるので、テストでは戻り値の型を緩める
  const send = jest.spyOn(client, 'send') as unknown as jest.Mock;
  send.mockResolvedValue({});
  return { storage: createR2PhotoStorage(CONFIG, client), send };
}

describe('配信側 (one-more-time #164)', () => {
  it('公開は保管側から同じキーで写し、形式とキャッシュの指定を付け直す', async () => {
    const { storage, send } = r2WithFakeSend();
    await storage.publish([
      'production/reviews/1/abc/720.webp',
      'production/reviews/1/abc/720.avif',
    ]);

    const inputs = send.mock.calls.map(([command]) => command.input);
    expect(inputs).toEqual([
      expect.objectContaining({
        Bucket: 'public-bucket',
        Key: 'production/reviews/1/abc/720.webp',
        CopySource: 'photo-bucket/production/reviews/1/abc/720.webp',
        MetadataDirective: 'REPLACE',
        ContentType: 'image/webp',
        CacheControl: expect.stringContaining('s-maxage='),
      }),
      expect.objectContaining({
        Key: 'production/reviews/1/abc/720.avif',
        ContentType: 'image/avif',
      }),
    ]);
  });

  it('公開をやめる時は、配信側から消して、その URL の CDN のキャッシュを 30 件ずつ消す', async () => {
    const client = createR2Client(CONFIG);
    const send = jest.spyOn(client, 'send') as unknown as jest.Mock;
    send.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    try {
      const storage = createR2PhotoStorage(
        { ...CONFIG, cachePurge: { zoneId: 'zone1', token: 'tok' } },
        client
      );
      const keys = Array.from({ length: 31 }, (_, i) => `preview/reviews/1/p${i}/320.webp`);
      await storage.unpublish(keys);

      expect(send.mock.calls[0][0].input).toMatchObject({
        Bucket: 'public-bucket',
        Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone1/purge_cache');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
      expect(JSON.parse(String(init.body)).files).toEqual(
        keys.slice(0, 30).map(key => `https://img.example.test/${key}`)
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('キャッシュを消せなかった時は投げる (呼び出し側が知る)', async () => {
    const { send } = r2WithFakeSend();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 403 }));
    try {
      const client = createR2Client(CONFIG);
      jest.spyOn(client, 'send').mockResolvedValue({} as never);
      const storage = createR2PhotoStorage(
        { ...CONFIG, cachePurge: { zoneId: 'z', token: 't' } },
        client
      );
      await expect(storage.unpublish(['preview/a/320.webp'])).rejects.toThrow('HTTP 403');
    } finally {
      fetchSpy.mockRestore();
      send.mockReset();
    }
  });
});

describe('R2 の置き場所', () => {
  it('受け取りの署名付き URL は、形式と長さを署名に含め、10 分で切れる', async () => {
    const { storage } = r2WithFakeSend();

    const { url, headers } = await storage.presignIntakeUpload('preview/reviews/1/abc', {
      contentType: 'image/heic',
      size: 12345,
    });

    const parsed = new URL(url);
    expect(parsed.host).toBe('intake-bucket.account.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe('/preview/reviews/1/abc');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host'])
    );
    // 空の本文のチェックサムを署名に入れない (入れるとブラウザの写真と合わず、R2 が断る)
    expect([...parsed.searchParams.keys()].filter(name => /checksum/i.test(name))).toEqual([]);
    expect(headers).toEqual({ 'Content-Type': 'image/heic' });
  });

  it('保管側へ置く・消す・読む URL は保管のバケットを使う', async () => {
    const { storage, send } = r2WithFakeSend();

    await storage.putStored('preview/reviews/1/abc/320.webp', new Uint8Array([1]), 'image/webp');
    await storage.deleteStored(['a/320.webp', 'a/320.avif']);
    await storage.deleteStored([]);
    const readUrl = new URL(await storage.presignStoredRead('preview/reviews/1/abc/320.webp'));

    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: 'photo-bucket', ContentType: 'image/webp' });
    const del = send.mock.calls[1][0] as DeleteObjectsCommand;
    expect(del.input.Delete?.Objects).toEqual([{ Key: 'a/320.webp' }, { Key: 'a/320.avif' }]);
    // 空の一覧では呼ばない
    expect(send).toHaveBeenCalledTimes(2);
    expect(readUrl.host).toBe('photo-bucket.account.r2.cloudflarestorage.com');
  });

  it('受け取った写真が無い時と、上限より大きい・長さが分からない時 (本文を閉じる) を分けて返す', async () => {
    const { storage, send } = r2WithFakeSend();
    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    await expect(storage.readIntake('x')).resolves.toEqual({ kind: 'missing' });

    const destroy = jest.fn();
    send.mockResolvedValueOnce({ ContentLength: 10 * 1024 * 1024 + 1, Body: { destroy } });
    await expect(storage.readIntake('x')).resolves.toEqual({ kind: 'too_large' });
    expect(destroy).toHaveBeenCalled();

    send.mockResolvedValueOnce({ Body: { destroy } });
    await expect(storage.readIntake('x')).resolves.toEqual({ kind: 'too_large' });

    send.mockResolvedValueOnce({
      ContentLength: 3,
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    await expect(storage.readIntake('x')).resolves.toEqual({
      kind: 'ok',
      body: new Uint8Array([1, 2, 3]),
    });
    expect((send.mock.calls[3][0] as GetObjectCommand).input).toEqual({
      Bucket: 'intake-bucket',
      Key: 'x',
    });
  });

  it('見つからない以外の失敗は投げる', async () => {
    const { storage, send } = r2WithFakeSend();
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));
    await expect(storage.readIntake('x')).rejects.toThrow('boom');
  });
});

describe('偽物の置き場所 (ファイル)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'review-photos-test-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('受け取り → 読む → 消す、保管 → 読む → 消す', async () => {
    const storage = createFakePhotoStorage(root);
    await storage.writeIntake('preview/reviews/1/a', new Uint8Array([9]));
    await expect(storage.readIntake('preview/reviews/1/a')).resolves.toEqual({
      kind: 'ok',
      body: new Uint8Array([9]),
    });
    await storage.deleteIntake('preview/reviews/1/a');
    await expect(storage.readIntake('preview/reviews/1/a')).resolves.toEqual({ kind: 'missing' });

    await storage.putStored('preview/reviews/1/a/320.webp', new Uint8Array([7]), 'image/webp');
    await expect(storage.readStored('preview/reviews/1/a/320.webp')).resolves.toEqual(
      new Uint8Array([7])
    );
    await storage.deleteStored(['preview/reviews/1/a/320.webp']);
    await expect(storage.readStored('preview/reviews/1/a/320.webp')).resolves.toBeNull();
  });

  it('キーで置き場所の外を指させない', async () => {
    const storage = createFakePhotoStorage(root);
    await expect(storage.writeIntake('../escape', new Uint8Array([1]))).rejects.toThrow(
      'invalid key'
    );
    await expect(storage.readStored('../../etc/passwd')).rejects.toThrow('invalid key');
  });
});

describe('置き場所の選び方', () => {
  const r2Env = {
    REVIEW_R2_ENDPOINT: CONFIG.endpoint,
    REVIEW_R2_ACCESS_KEY_ID: 'id',
    REVIEW_R2_SECRET_ACCESS_KEY: 'secret',
    REVIEW_R2_INTAKE_BUCKET: 'i',
    REVIEW_R2_PHOTO_BUCKET: 'p',
    REVIEW_R2_PUBLIC_BUCKET: 'pub',
    REVIEW_PUBLIC_MEDIA_BASE_URL: 'https://img.example.test/',
  };

  it('偽物は手元とテストだけ。ビルドした物では R2 か、無ければ null', () => {
    expect(
      getReviewPhotoStorage({ REVIEW_PHOTO_STORAGE: 'fake', NODE_ENV: 'test' })
    ).toHaveProperty('root');
    expect(
      getReviewPhotoStorage({ REVIEW_PHOTO_STORAGE: 'fake', NODE_ENV: 'production' })
    ).toBeNull();
    expect(
      getReviewPhotoStorage({
        REVIEW_PHOTO_STORAGE: 'fake',
        NODE_ENV: 'development',
        VERCEL_ENV: 'production',
      })
    ).toBeNull();
    expect(getReviewPhotoStorage({ ...r2Env, NODE_ENV: 'production' })).not.toBeNull();
    expect(
      getReviewPhotoStorage({ ...r2Env, REVIEW_R2_PHOTO_BUCKET: '', NODE_ENV: 'production' })
    ).toBeNull();
  });

  it('キーの先頭は本番だけ production/', () => {
    expect(reviewPhotoKeyPrefix({ VERCEL_ENV: 'production' })).toBe('production/');
    expect(reviewPhotoKeyPrefix({ VERCEL_ENV: 'preview' })).toBe('preview/');
    expect(reviewPhotoKeyPrefix({})).toBe('preview/');
    expect(storedVariantKey('preview/reviews/1/a', 720, 'avif')).toBe(
      'preview/reviews/1/a/720.avif'
    );
  });
});
