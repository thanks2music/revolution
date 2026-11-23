/**
 * Layer 2: 口コミの写真の Server Action の契約 (one-more-time #163)
 *
 *   - 口コミは URL の開催と会員から引く。会員のこの開催の口コミが無い・書けない・置き場所が無い時は、
 *     理由の文を返す (操作の層を呼ばない)
 *   - 操作の層の結果を、利用者向けの文にする
 *   - 写真を足して口コミが審査中に戻った時だけ、ページを作り直して審査を走らせる
 *   - 想定外の例外は Sentry に送り、型付きの結果で返す
 *
 * 写真の操作そのもの (変換・保管・DB) は __tests__/integration/review-photos.test.ts で確かめる。
 */

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/reviews/write-context', () => ({
  resolveWriteContext: jest.fn(),
  modeFor: jest.fn(),
  screenAfterSubmit: jest.fn(),
}));
jest.mock('@/lib/reviews/authoring', () => ({ findOwnReview: jest.fn() }));
jest.mock('@revolution/reviews/photos/operations', () => ({
  requestPhotoUpload: jest.fn(),
  ingestPhoto: jest.fn(),
  removePhoto: jest.fn(),
  reorderPhotos: jest.fn(),
}));
jest.mock('@revolution/reviews/photos/storage', () => ({
  getReviewPhotoStorage: jest.fn(),
  reviewPhotoKeyPrefix: () => 'preview/',
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/server', () => ({ after: jest.fn() }));

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import {
  attachReviewPhoto,
  removeReviewPhoto,
  reorderReviewPhotos,
  requestReviewPhotoUpload,
} from '@/actions/review-photos';
import { findOwnReview } from '@/lib/reviews/authoring';
import {
  ingestPhoto,
  removePhoto,
  reorderPhotos,
  requestPhotoUpload,
} from '@revolution/reviews/photos/operations';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { modeFor, resolveWriteContext } from '@/lib/reviews/write-context';

const route = { eventType: 'collabo-cafe', eventId: '12', occurrenceSlug: 'shibuya' };
const admin = { admin: true };
const storage = { fake: true };
const PHOTO = { id: 3, width: 720, height: 540, avifSrcSet: '', webpSrcSet: '', src: '/p.webp' };

const mocked = <T>(fn: T) => fn as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mocked(resolveWriteContext).mockResolvedValue({
    ok: true,
    detail: { occurrence: { id: 7, status: 'ongoing', startsOn: null, endsOn: null } },
    profileId: 'p1',
    admin,
    paths: ['/collabo-cafe/12/shibuya', '/collabo-cafe/12'],
  });
  mocked(findOwnReview).mockResolvedValue({ id: 99, status: 'published' });
  mocked(modeFor).mockReturnValue({ kind: 'edit' });
  mocked(getReviewPhotoStorage).mockReturnValue(storage);
});

describe('写真を付けられるか', () => {
  it('形式か大きさが違えば、口コミを引く前に断る', async () => {
    await expect(
      requestReviewPhotoUpload(route, { contentType: 'image/gif', size: 10 })
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('JPEG・PNG・HEIC'),
    });
    await expect(
      requestReviewPhotoUpload(route, { contentType: 'image/jpeg', size: 11 * 1024 * 1024 })
    ).resolves.toMatchObject({ ok: false });
    expect(resolveWriteContext).not.toHaveBeenCalled();
  });

  it.each([
    [
      '未ログイン',
      () => mocked(resolveWriteContext).mockResolvedValue({ ok: false, reason: 'needs_login' }),
      { needsAuth: true },
    ],
    [
      '口コミが無い',
      () => mocked(findOwnReview).mockResolvedValue(null),
      { error: expect.stringContaining('下書きを保存') },
    ],
    [
      '書けない開催',
      () => mocked(modeFor).mockReturnValue({ kind: 'blocked' }),
      { error: expect.stringContaining('今は写真を付けられません') },
    ],
    [
      '置き場所が無い',
      () => mocked(getReviewPhotoStorage).mockReturnValue(null),
      { error: expect.stringContaining('時間をおいて') },
    ],
  ])('%s時は、操作の層を呼ばずに理由を返す', async (_label, arrange, expected) => {
    arrange();
    await expect(
      requestReviewPhotoUpload(route, { contentType: 'image/jpeg', size: 10 })
    ).resolves.toMatchObject({
      ok: false,
      ...expected,
    });
    expect(requestPhotoUpload).not.toHaveBeenCalled();
  });
});

describe('requestReviewPhotoUpload', () => {
  it('会員の口コミと、キーの先頭を操作の層に渡し、URL を返す', async () => {
    mocked(requestPhotoUpload).mockResolvedValue({
      kind: 'ok',
      photoId: 'id',
      url: 'https://u',
      headers: {},
    });

    await expect(
      requestReviewPhotoUpload(route, { contentType: 'image/heic', size: 10 })
    ).resolves.toEqual({
      ok: true,
      photoId: 'id',
      url: 'https://u',
      headers: {},
    });
    expect(requestPhotoUpload).toHaveBeenCalledWith(
      { db: admin, storage, prefix: 'preview/' },
      { profileId: 'p1', reviewId: 99, file: { contentType: 'image/heic', size: 10 } }
    );
  });

  it.each([
    ['full', '10 枚まで'],
    ['busy', '取り込めていない写真が多い'],
  ])('%s は理由の文にする', async (kind, text) => {
    mocked(requestPhotoUpload).mockResolvedValue({ kind });
    await expect(
      requestReviewPhotoUpload(route, { contentType: 'image/png', size: 10 })
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(text),
    });
  });
});

describe('attachReviewPhoto', () => {
  it.each([
    ['公開中などから審査中に戻った', { requeued: true }, 2, 1],
    ['下書きか審査中の口コミに足した', { requeued: false }, 0, 0],
  ])('%s時: ページの作り直し %i 回、審査 %i 回', async (_label, flags, revalidates, screens) => {
    mocked(ingestPhoto).mockResolvedValue({ kind: 'ok', photo: PHOTO, ...flags });
    await expect(attachReviewPhoto(route, 'pid')).resolves.toEqual({ ok: true, photo: PHOTO });
    expect(revalidatePath).toHaveBeenCalledTimes(revalidates);
    expect(after).toHaveBeenCalledTimes(screens);
  });

  it.each([
    [{ kind: 'rejected', reason: 'too_large' }, '10MB'],
    [{ kind: 'rejected', reason: 'unsupported' }, 'JPEG・PNG・HEIC'],
    [{ kind: 'rejected', reason: 'unreadable' }, '読み取れません'],
    [{ kind: 'missing' }, '選び直して'],
    [{ kind: 'full' }, '10 枚まで'],
  ])('%o は理由の文にする', async (outcome, text) => {
    mocked(ingestPhoto).mockResolvedValue(outcome);
    await expect(attachReviewPhoto(route, 'pid')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(text),
    });
  });

  it('想定外の例外は Sentry に送り、型付きの結果で返す', async () => {
    mocked(ingestPhoto).mockRejectedValue(new Error('R2 is down'));
    await expect(attachReviewPhoto(route, 'pid')).resolves.toMatchObject({ ok: false });
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('removeReviewPhoto / reorderReviewPhotos', () => {
  it('既に外れている写真を外しても成功として返す。ID の形が違えば操作しない', async () => {
    mocked(removePhoto).mockResolvedValue({ kind: 'not_found' });
    await expect(removeReviewPhoto(route, 3)).resolves.toEqual({ ok: true });
    await expect(removeReviewPhoto(route, -1)).resolves.toMatchObject({ ok: false });
    expect(removePhoto).toHaveBeenCalledTimes(1);
  });

  it('並びの ID の形が違う・口コミの写真と合わない時は断る', async () => {
    await expect(reorderReviewPhotos(route, [])).resolves.toMatchObject({ ok: false });
    expect(reorderPhotos).not.toHaveBeenCalled();
    mocked(reorderPhotos).mockResolvedValue({ kind: 'mismatch' });
    await expect(reorderReviewPhotos(route, [1, 2])).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('読み込み直して'),
    });
    mocked(reorderPhotos).mockResolvedValue({ kind: 'reordered' });
    await expect(reorderReviewPhotos(route, [2, 1])).resolves.toEqual({ ok: true });
  });
});
