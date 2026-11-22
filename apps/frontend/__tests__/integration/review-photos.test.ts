/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  ingestPhoto,
  listOwnPhotos,
  removePhoto,
  reorderPhotos,
  requestPhotoUpload,
  type PhotoContext,
} from '@/lib/reviews/photos/operations';
import { createFakePhotoStorage, type FakePhotoStorage } from '@/lib/reviews/photos/storage';
import {
  anonClient,
  createTestDataScope,
  jstDate,
  signInAsMember,
  type TestDataScope,
  type TestMember,
} from '@/test-support/test-data';

/**
 * 口コミの写真 (one-more-time #163)。本物の Postgres・RLS・トリガに対して、操作の層を偽の置き場所
 * (一時ディレクトリのファイル) で叩く。
 */
describe('口コミの写真', () => {
  let data: TestDataScope;
  let storage: FakePhotoStorage;
  let ctx: PhotoContext;

  beforeEach(async () => {
    data = createTestDataScope();
    storage = createFakePhotoStorage(await mkdtemp(path.join(os.tmpdir(), 'review-photos-it-')));
    ctx = { db: data.admin, storage, prefix: 'preview/' };
  });

  afterEach(async () => {
    await data.cleanup();
    await rm(storage.root, { recursive: true, force: true });
  });

  async function reviewOf(
    status: 'draft' | 'pending' | 'published' | 'rejected' | 'needs_review' | 'hidden'
  ) {
    const event = await data.createEvent();
    const occurrence = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const member = await data.createMember();
    const { data: row, error } = await data.admin
      .from('reviews')
      .insert({
        occurrence_id: occurrence.id,
        user_id: member.userId,
        status,
        rating: 4,
        visited_on: jstDate(-1),
        ...(status !== 'draft' ? { submitted_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .single();
    if (error) throw error;
    return { reviewId: row.id as number, member, occurrenceId: occurrence.id };
  }

  async function jpegWithGps(width = 1600, height = 1200): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#c84' } })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1' } })
      .jpeg()
      .toBuffer();
  }

  /** ブラウザが署名付き URL へ上げた所までを再現する */
  async function upload(reviewId: number, member: TestMember, body: Buffer) {
    const request = await requestPhotoUpload(ctx, {
      profileId: member.userId,
      reviewId,
      file: { contentType: 'image/jpeg', size: body.length },
    });
    if (request.kind !== 'ok') throw new Error(`upload refused: ${request.kind}`);
    await storage.writeIntake(`preview/reviews/${reviewId}/${request.photoId}`, body);
    return request.photoId;
  }

  async function storedFiles(): Promise<string[]> {
    const dir = path.join(storage.root, 'stored');
    try {
      return (await readdir(dir, { recursive: true }))
        .filter(name => /\.(webp|avif)$/.test(String(name)))
        .map(String);
    } catch {
      return [];
    }
  }

  it('上げた写真を変換して保管し、元の写真を消す。保管した物に位置情報は残らない', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const photoId = await upload(reviewId, member, await jpegWithGps());

    const result = await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });

    expect(result).toMatchObject({
      kind: 'ok',
      requeued: false,
      photo: { width: 1200, height: 1600 },
    });
    await expect(storage.readIntake(`preview/reviews/${reviewId}/${photoId}`)).resolves.toEqual({
      kind: 'missing',
    });
    const files = await storedFiles();
    expect(files.sort()).toEqual(
      ['1200.avif', '1200.webp', '320.avif', '320.webp', '720.avif', '720.webp'].map(name =>
        path.join('preview/reviews', String(reviewId), photoId, name)
      )
    );
    const stored = await storage.readStored(`preview/reviews/${reviewId}/${photoId}/720.webp`);
    expect((await sharp(stored!).metadata()).exif).toBeUndefined();
  });

  it('JPEG・PNG・HEIC でない物は断り、元の写真を消す', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    const photoId = await upload(reviewId, member, gif);

    await expect(
      ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId })
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'unsupported',
    });
    await expect(storage.readIntake(`preview/reviews/${reviewId}/${photoId}`)).resolves.toEqual({
      kind: 'missing',
    });
    await expect(storedFiles()).resolves.toEqual([]);
  });

  it('1 つの口コミに 10 枚まで。DB のトリガでも止める', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const rows = Array.from({ length: 10 }, (_, i) => ({
      review_id: reviewId,
      object_key: `preview/reviews/${reviewId}/x${i}`,
      sort_order: i,
      width: 10,
      height: 10,
      variant_widths: [10],
    }));
    const filled = await data.admin.from('review_images').insert(rows);
    if (filled.error) throw filled.error;

    await expect(
      requestPhotoUpload(ctx, {
        profileId: member.userId,
        reviewId,
        file: { contentType: 'image/png', size: 100 },
      })
    ).resolves.toEqual({ kind: 'full' });
    const eleventh = await data.admin
      .from('review_images')
      .insert({ ...rows[0], object_key: 'eleventh' });
    expect(eleventh.error?.message).toContain('at most 10 images');
  });

  it('公開中の口コミに写真を足すと、審査中に戻り、最終編集日が入る', async () => {
    const { reviewId, member } = await reviewOf('published');
    const photoId = await upload(reviewId, member, await jpegWithGps(400, 300));

    const result = await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });

    expect(result).toMatchObject({ kind: 'ok', requeued: true });
    const { data: review } = await data.admin
      .from('reviews')
      .select('status, edited_at')
      .eq('id', reviewId)
      .single();
    expect(review).toMatchObject({ status: 'pending', edited_at: expect.any(String) });
  });

  it.each([
    ['published', 'pending', true],
    ['rejected', 'pending', true],
    ['needs_review', 'pending', true],
    ['hidden', 'pending', true],
    ['pending', 'pending', false],
    ['draft', 'draft', false],
  ] as const)(
    '%s の口コミに写真を足すと %s (審査中に戻したか: %p)',
    async (status, after, requeued) => {
      const { reviewId, member } = await reviewOf(status);
      const photoId = await upload(reviewId, member, await jpegWithGps(400, 300));

      await expect(
        ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId })
      ).resolves.toMatchObject({
        kind: 'ok',
        requeued,
      });
      const { data: review } = await data.admin
        .from('reviews')
        .select('status')
        .eq('id', reviewId)
        .single();
      expect(review?.status).toBe(after);
    }
  );

  it('消した口コミには、トリガが写真の行を足させない', async () => {
    const { reviewId } = await reviewOf('draft');
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', reviewId);
    const { error } = await data.admin.from('review_images').insert({
      review_id: reviewId,
      object_key: `preview/reviews/${reviewId}/deleted`,
      width: 10,
      height: 10,
      variant_widths: [10],
    });
    expect(error?.message).toContain('not deleted');
  });

  it('外した後に保管側の物を消せなくても、外せたと返す', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const photoId = await upload(reviewId, member, await jpegWithGps(400, 300));
    const result = await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });
    if (result.kind !== 'ok') throw new Error(result.kind);
    const failing = { ...storage, deleteStored: () => Promise.reject(new Error('R2 is down')) };

    await expect(
      removePhoto(
        { ...ctx, storage: failing },
        { profileId: member.userId, reviewId, photoId: result.photo.id }
      )
    ).resolves.toEqual({ kind: 'removed' });
    await expect(listOwnPhotos(ctx, { profileId: member.userId, reviewId })).resolves.toEqual([]);
  });

  it('並べ替えと外す。外すと保管側の物も消える', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const ids: number[] = [];
    for (const size of [400, 500, 600]) {
      const photoId = await upload(reviewId, member, await jpegWithGps(size, size));
      const result = await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });
      if (result.kind !== 'ok') throw new Error(result.kind);
      ids.push(result.photo.id);
    }

    await expect(
      reorderPhotos(ctx, { profileId: member.userId, reviewId, photoIds: [ids[2], ids[0], ids[1]] })
    ).resolves.toEqual({ kind: 'reordered' });
    await expect(
      reorderPhotos(ctx, { profileId: member.userId, reviewId, photoIds: [ids[0], ids[1]] })
    ).resolves.toEqual({ kind: 'mismatch' });
    expect(
      (await listOwnPhotos(ctx, { profileId: member.userId, reviewId })).map(photo => photo.id)
    ).toEqual([ids[2], ids[0], ids[1]]);

    const before = (await storedFiles()).length;
    await expect(
      removePhoto(ctx, { profileId: member.userId, reviewId, photoId: ids[0] })
    ).resolves.toEqual({
      kind: 'removed',
    });
    expect(
      (await listOwnPhotos(ctx, { profileId: member.userId, reviewId })).map(photo => photo.id)
    ).toEqual([ids[2], ids[1]]);
    // 外した写真 (幅 400: 320 と 400 の 2 段 × 2 形式) の分だけ減る
    expect((await storedFiles()).length).toBe(before - 4);
  });

  it('本人に見せる URL は、作った段ごとの srcset になる', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const photoId = await upload(reviewId, member, await jpegWithGps(2000, 1500));
    await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });

    const [photo] = await listOwnPhotos(ctx, { profileId: member.userId, reviewId });

    expect(photo.webpSrcSet.split(', ').map(entry => entry.split(' ')[1])).toEqual([
      '320w',
      '720w',
      '1440w',
    ]);
    expect(photo.avifSrcSet).toContain('/1440.avif 1440w');
    expect(photo.src).toMatch(/\/1440\.webp$/);
  });

  it('他人の口コミには、写真を上げる URL も出さず、外しも並べ替えもできない', async () => {
    const { reviewId } = await reviewOf('draft');
    const other = await data.createMember();

    await expect(
      requestPhotoUpload(ctx, {
        profileId: other.userId,
        reviewId,
        file: { contentType: 'image/jpeg', size: 10 },
      })
    ).resolves.toEqual({ kind: 'not_found' });
    await expect(
      ingestPhoto(ctx, {
        profileId: other.userId,
        reviewId,
        photoId: '00000000-0000-4000-8000-000000000000',
      })
    ).resolves.toEqual({ kind: 'not_found' });
    await expect(
      removePhoto(ctx, { profileId: other.userId, reviewId, photoId: 1 })
    ).resolves.toEqual({
      kind: 'not_found',
    });
    await expect(listOwnPhotos(ctx, { profileId: other.userId, reviewId })).resolves.toEqual([]);
  });

  it('写真の行は本人だけが読める。会員は行を直接足せない', async () => {
    const { reviewId, member } = await reviewOf('published');
    const inserted = await data.admin.from('review_images').insert({
      review_id: reviewId,
      object_key: `preview/reviews/${reviewId}/a`,
      width: 10,
      height: 10,
      variant_widths: [10],
    });
    if (inserted.error) throw inserted.error;

    const owner = await signInAsMember(member);
    const stranger = await signInAsMember(await data.createMember());
    const own = await owner.from('review_images').select('id, width').eq('review_id', reviewId);
    const others = await stranger.from('review_images').select('id').eq('review_id', reviewId);
    const anon = await anonClient().from('review_images').select('id').eq('review_id', reviewId);

    expect(own.data).toHaveLength(1);
    expect(others.data).toEqual([]);
    expect(anon.error?.code).toBe('42501');
    const direct = await owner.from('review_images').insert({
      review_id: reviewId,
      object_key: 'someone-else/photo',
      width: 10,
      height: 10,
      variant_widths: [10],
    });
    expect(direct.error?.code).toBe('42501');
  });

  it('同じ写真を 2 回取り込んでも、行は 1 つ。後から来た方は先の行を返す', async () => {
    const { reviewId, member } = await reviewOf('draft');
    const photoId = await upload(reviewId, member, await jpegWithGps(500, 400));

    const [first, second] = await Promise.all([
      ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId }),
      ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId }),
    ]);
    const again = await ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId });

    const ids = [first, second, again].map(result =>
      result.kind === 'ok' ? result.photo.id : result.kind
    );
    expect(new Set(ids).size).toBe(1);
    const { count } = await data.admin
      .from('review_images')
      .select('id', { count: 'exact', head: true })
      .eq('review_id', reviewId);
    expect(count).toBe(1);
    // 保管側の物は残っている (2 つ目が消していない)。写真は向きの印で縦長になり、幅は 400
    await expect(
      storage.readStored(`preview/reviews/${reviewId}/${photoId}/400.webp`)
    ).resolves.not.toBeNull();
  });

  it('受け取り場所に無い写真と、形のおかしな写真の ID は取り込まない', async () => {
    const { reviewId, member } = await reviewOf('draft');
    await expect(
      ingestPhoto(ctx, {
        profileId: member.userId,
        reviewId,
        photoId: '00000000-0000-4000-8000-000000000000',
      })
    ).resolves.toEqual({ kind: 'missing' });
    await expect(
      ingestPhoto(ctx, { profileId: member.userId, reviewId, photoId: '../../other' })
    ).resolves.toEqual({ kind: 'missing' });
  });
});
