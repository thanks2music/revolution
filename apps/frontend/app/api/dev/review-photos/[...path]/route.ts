/**
 * 偽の写真の置き場所 (lib/reviews/photos/storage.ts の createFakePhotoStorage) の出入り口。
 * 手元の開発と E2E だけで使う (one-more-time #163)。
 *
 * - PUT /api/dev/review-photos/intake/<キー>?size=<バイト数>: ブラウザが署名付き URL の代わりに上げる
 * - GET /api/dev/review-photos/stored/<キー>: 本人が見る、短時間だけ有効な URL の代わり
 *
 * 偽物を使わない環境 (本番・Preview、`REVIEW_PHOTO_STORAGE` が fake でない) では、どちらも 404 を返す。
 * R2 と同じく、上げる時は形式と大きさが署名 (ここでは URL の size) と合っていることを確かめる。
 */
import { NextResponse } from 'next/server';

import { MAX_REVIEW_PHOTO_BYTES, REVIEW_PHOTO_TYPES } from '@revolution/schemas/review-photo';

import { createFakePhotoStorage, getReviewPhotoStorage } from '@/lib/reviews/photos/storage';
import { allowsFakeBackends } from '@/lib/reviews/fake-backends';

type Params = { params: Promise<{ path: string[] }> };

function fakeStorage() {
  if (process.env.REVIEW_PHOTO_STORAGE !== 'fake' || !allowsFakeBackends(process.env)) return null;
  // getReviewPhotoStorage と同じ置き場所 (既定の一時ディレクトリ)
  return getReviewPhotoStorage() ? createFakePhotoStorage() : null;
}

const notFound = () => new NextResponse(null, { status: 404 });

export async function PUT(request: Request, { params }: Params) {
  const storage = fakeStorage();
  const [area, ...rest] = (await params).path;
  if (!storage || area !== 'intake' || rest.length === 0) return notFound();

  const expected = Number(new URL(request.url).searchParams.get('size'));
  const contentType = request.headers.get('content-type') ?? '';
  if (!(REVIEW_PHOTO_TYPES as readonly string[]).includes(contentType)) {
    return new NextResponse('unsupported content type', { status: 400 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length !== expected || body.length > MAX_REVIEW_PHOTO_BYTES) {
    return new NextResponse('size does not match', { status: 400 });
  }
  // 置き場所の外を指すキーは、置き場所が断る (invalid key)
  const written = await storage.writeIntake(rest.join('/'), body).then(
    () => true,
    () => false
  );
  return new NextResponse(null, { status: written ? 200 : 404 });
}

const CONTENT_TYPES: Record<string, string> = { webp: 'image/webp', avif: 'image/avif' };

export async function GET(_request: Request, { params }: Params) {
  const storage = fakeStorage();
  const [area, ...rest] = (await params).path;
  if (!storage || area !== 'stored' || rest.length === 0) return notFound();
  const key = rest.join('/');
  const body = await storage.readStored(key).catch(() => null);
  const type = CONTENT_TYPES[key.split('.').pop() ?? ''];
  if (!body || !type) return notFound();
  return new NextResponse(Buffer.from(body), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' },
  });
}
