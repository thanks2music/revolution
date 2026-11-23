/**
 * 偽の写真の置き場所 (shared/reviews/photos/storage.ts の createFakePhotoStorage) の読み出し口。
 * 手元の開発と E2E だけで使う (公開サイトの app/api/dev/review-photos と同じ作り。管理アプリは読むだけ)。
 * 偽物を使わない環境 (本番、REVIEW_PHOTO_STORAGE が fake でない) では 404
 */
import { NextResponse } from 'next/server';

import { allowsFakeBackends } from '@revolution/reviews/fake-backends';
import { contentTypeOf, createFakePhotoStorage } from '@revolution/reviews/photos/storage';

type Params = { params: Promise<{ path: string[] }> };

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(_request: Request, { params }: Params) {
  if (process.env.REVIEW_PHOTO_STORAGE !== 'fake' || !allowsFakeBackends(process.env)) {
    return notFound();
  }
  const storage = createFakePhotoStorage();
  const [area, ...rest] = (await params).path;
  if (area !== 'stored' || rest.length === 0) return notFound();
  const key = rest.join('/');
  const body = await storage.readStored(key).catch(() => null);
  const type = contentTypeOf(key);
  if (!body || !type.startsWith('image/')) return notFound();
  return new NextResponse(Buffer.from(body), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' },
  });
}
