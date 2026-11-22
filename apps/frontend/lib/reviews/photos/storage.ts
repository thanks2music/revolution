import 'server-only';

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { presentEnvValue } from '@revolution/slack/env';

import { allowsFakeBackends } from '@/lib/reviews/fake-backends';
import { MAX_REVIEW_PHOTO_BYTES } from '@revolution/schemas/review-photo';

/**
 * 口コミの写真の置き場所の口 (one-more-time #163)。
 *
 * - 受け取り (intake): ブラウザが署名付き URL で直接上げる。R2 のライフサイクルで 1 日で消える
 * - 保管 (stored): 変換した表示用の写真。非公開。本人は短時間だけ有効な URL で見る
 *
 * 公開の配信側は #164 で足す。キーの先頭に環境 (`production/` か `preview/`) を付け、本番と
 * Preview・手元が同じバケットを使っても混ざらないようにする。
 */
export type ReviewPhotoStorage = {
  /** 受け取り場所へ上げる署名付き URL。形式と長さを署名に入れる (違う物は R2 が断る) */
  presignIntakeUpload(
    key: string,
    file: { contentType: string; size: number }
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** 受け取った写真を読む */
  readIntake(key: string): Promise<IntakeRead>;
  deleteIntake(key: string): Promise<void>;
  putStored(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteStored(keys: string[]): Promise<void>;
  /** 保管側の写真を短時間だけ見られる URL */
  presignStoredRead(key: string): Promise<string>;
};

export type IntakeRead =
  { kind: 'ok'; body: Uint8Array } | { kind: 'missing' } | { kind: 'too_large' };

/** 署名付き URL の有効期間 */
const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const READ_URL_TTL_SECONDS = 10 * 60;

/** 環境ごとのキーの先頭。本番だけ production/、それ以外 (Preview・手元・テスト) は preview/ */
export function reviewPhotoKeyPrefix(
  env: Record<string, string | undefined> = process.env
): string {
  return env.VERCEL_ENV === 'production' ? 'production/' : 'preview/';
}

/**
 * 写真のキー。受け取り場所 (元の写真) と保管側 (段ごとの物の元。DB の object_key) で同じ。
 * 写真ごとの ID はサーバーが決める
 */
export function photoKey(prefix: string, reviewId: number, photoId: string): string {
  return `${prefix}reviews/${reviewId}/${photoId}`;
}

/** 保管する形式。段ごとに両方を作る (順は WebP, AVIF) */
export const REVIEW_PHOTO_FORMATS = ['webp', 'avif'] as const;
export type StoredPhotoFormat = (typeof REVIEW_PHOTO_FORMATS)[number];

export function storedVariantKey(
  objectKey: string,
  width: number,
  format: StoredPhotoFormat
): string {
  return `${objectKey}/${width}.${format}`;
}

/** 写真 1 枚の、保管側の段ごとの物のキー全部 */
export function variantKeys(objectKey: string, widths: readonly number[]): string[] {
  return widths.flatMap(width =>
    REVIEW_PHOTO_FORMATS.map(format => storedVariantKey(objectKey, width, format))
  );
}

// ───────────────────────────────────────────────
// R2
// ───────────────────────────────────────────────

export type R2PhotoStorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  intakeBucket: string;
  photoBucket: string;
};

/** R2 の S3 API のクライアント */
export function createR2Client(
  config: Pick<R2PhotoStorageConfig, 'endpoint' | 'accessKeyId' | 'secretAccessKey'>
): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // SDK の既定は PUT にチェックサム (CRC32) を付ける。署名付き URL では本文が無いまま計算され、
    // 空の本文の値 (AAAAAA==) が署名に入り、ブラウザが上げる写真と合わずに R2 が断る
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function createR2PhotoStorage(
  config: R2PhotoStorageConfig,
  client: S3Client = createR2Client(config)
): ReviewPhotoStorage {
  return {
    async presignIntakeUpload(key, file) {
      const command = new PutObjectCommand({
        Bucket: config.intakeBucket,
        Key: key,
        ContentType: file.contentType,
        ContentLength: file.size,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // 長さと形式を署名に含める (ブラウザが違う物を送ると R2 が断る)
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return { url, headers: { 'Content-Type': file.contentType } };
    },

    async readIntake(key) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: config.intakeBucket, Key: key })
        );
        if (!object.Body) return { kind: 'missing' };
        // 長さが分からない物も読まない (上限の無い読み込みを避ける)
        if (object.ContentLength === undefined || object.ContentLength > MAX_REVIEW_PHOTO_BYTES) {
          // 読まない本文は閉じる (接続を返す)
          (object.Body as { destroy?: () => void }).destroy?.();
          return { kind: 'too_large' };
        }
        return { kind: 'ok', body: await object.Body.transformToByteArray() };
      } catch (error) {
        if (isNotFound(error)) return { kind: 'missing' };
        throw error;
      }
    },

    async deleteIntake(key) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.intakeBucket,
          Delete: { Objects: [{ Key: key }] },
        })
      );
    },

    async putStored(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.photoBucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
    },

    async deleteStored(keys) {
      // DeleteObjects は 1 回に 1000 件まで。1 枚の写真は 6 段なので、ここで分ける必要は無い
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.photoBucket,
          Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
        })
      );
    },

    async presignStoredRead(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.photoBucket, Key: key }), {
        expiresIn: READ_URL_TTL_SECONDS,
      });
    },
  };
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

// ───────────────────────────────────────────────
// 偽物 (手元・E2E・結合テスト)
// ───────────────────────────────────────────────

/**
 * ファイルに置く偽物。開発サーバーの route と Server Action は別の層で動くため、メモリではなく
 * ファイルで共有する。署名付き URL の代わりに、開発用の route (`/api/dev/review-photos/...`) の URL を返す
 */
export const FAKE_PHOTO_STORAGE_ROUTE = '/api/dev/review-photos';

export type FakePhotoStorage = ReviewPhotoStorage & {
  root: string;
  /** 開発用の route が、ブラウザから届いた写真を受け取り場所に置く */
  writeIntake(key: string, body: Uint8Array): Promise<void>;
  /** 開発用の route が、保管側の写真を返す。無ければ null */
  readStored(key: string): Promise<Uint8Array | null>;
};

export function createFakePhotoStorage(
  root: string = path.join(os.tmpdir(), 'revolution-review-photos')
): FakePhotoStorage {
  const file = (area: 'intake' | 'stored', key: string) => {
    const resolved = path.resolve(root, area, key);
    // キーで root の外を指させない
    if (!resolved.startsWith(path.resolve(root, area) + path.sep)) throw new Error('invalid key');
    return resolved;
  };
  const write = async (target: string, body: Uint8Array) => {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  };
  return {
    root,
    async presignIntakeUpload(key, file) {
      return {
        url: `${FAKE_PHOTO_STORAGE_ROUTE}/intake/${key}?size=${file.size}`,
        headers: { 'Content-Type': file.contentType },
      };
    },
    async readIntake(key) {
      try {
        const target = file('intake', key);
        if ((await stat(target)).size > MAX_REVIEW_PHOTO_BYTES) return { kind: 'too_large' };
        return { kind: 'ok', body: new Uint8Array(await readFile(target)) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
        throw error;
      }
    },
    async deleteIntake(key) {
      await rm(file('intake', key), { force: true });
    },
    async putStored(key, body) {
      await write(file('stored', key), body);
    },
    async deleteStored(keys) {
      await Promise.all(keys.map(key => rm(file('stored', key), { force: true })));
    },
    async presignStoredRead(key) {
      return `${FAKE_PHOTO_STORAGE_ROUTE}/stored/${key}`;
    },
    async writeIntake(key, body) {
      await write(file('intake', key), body);
    },
    async readStored(key) {
      try {
        return new Uint8Array(await readFile(file('stored', key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}

// ───────────────────────────────────────────────
// 選び方
// ───────────────────────────────────────────────

/**
 * env から置き場所を選ぶ。
 *
 * | env | 置き場所 |
 * |---|---|
 * | `REVIEW_PHOTO_STORAGE=fake` (`NODE_ENV` が development か test の時だけ) | 偽物 (ファイル) |
 * | `REVIEW_R2_*` がすべてある | R2 |
 * | どちらも無い | null (写真の操作は「今は写真を付けられません」を返す) |
 *
 * 審査器と同じく、ビルドした物 (本番と Preview) では偽物を選ばない。
 */
export function getReviewPhotoStorage(
  env: Record<string, string | undefined> = process.env
): ReviewPhotoStorage | null {
  if (env.REVIEW_PHOTO_STORAGE === 'fake' && allowsFakeBackends(env))
    return createFakePhotoStorage();
  const config = {
    endpoint: presentEnvValue(env.REVIEW_R2_ENDPOINT),
    accessKeyId: presentEnvValue(env.REVIEW_R2_ACCESS_KEY_ID),
    secretAccessKey: presentEnvValue(env.REVIEW_R2_SECRET_ACCESS_KEY),
    intakeBucket: presentEnvValue(env.REVIEW_R2_INTAKE_BUCKET),
    photoBucket: presentEnvValue(env.REVIEW_R2_PHOTO_BUCKET),
  };
  if (Object.values(config).some(value => !value)) return null;
  return createR2PhotoStorage(config as R2PhotoStorageConfig);
}
