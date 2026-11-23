/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { screenSubmittedReview } from '@/lib/reviews/operations';
import { listOwnReviews } from '@/lib/reviews/own-reviews';
import { syncPhotoDelivery } from '@/lib/reviews/photos/delivery';
import {
  ingestPhoto,
  removePhoto,
  requestPhotoUpload,
  type PhotoContext,
} from '@/lib/reviews/photos/operations';
import { createFakePhotoStorage, type FakePhotoStorage } from '@/lib/reviews/photos/storage';
import { createFakeScreener } from '@/lib/reviews/screener/fake-screener';
import { createTestDataScope, jstDate, type TestDataScope } from '@/test-support/test-data';

/**
 * 写真の審査と配信側 (one-more-time #164)。本物の Postgres・RLS・トリガに対して、偽の審査器
 * (本文の目印で写真ごとの判定が決まる) と偽の置き場所 (配信側もファイル) で操作の層を叩く。
 */
describe('写真の審査と配信側', () => {
  let data: TestDataScope;
  let storage: FakePhotoStorage;
  let ctx: PhotoContext;
  const screener = createFakeScreener();

  beforeEach(async () => {
    data = createTestDataScope();
    storage = createFakePhotoStorage(await mkdtemp(path.join(os.tmpdir(), 'review-delivery-it-')));
    ctx = { db: data.admin, storage, prefix: 'preview/' };
  });

  afterEach(async () => {
    await data.cleanup();
    await rm(storage.root, { recursive: true, force: true });
  });

  /** 審査中の口コミに、写真を n 枚付ける (幅で見分ける) */
  async function pendingReviewWithPhotos(body: string, widths: number[]) {
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
        status: 'pending',
        rating: 4,
        body,
        visited_on: jstDate(-1),
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    const reviewId = row.id as number;
    for (const width of widths) {
      const jpeg = await sharp({ create: { width, height: 300, channels: 3, background: '#48c' } })
        .jpeg()
        .toBuffer();
      const ticket = await requestPhotoUpload(ctx, {
        profileId: member.userId,
        reviewId,
        file: { contentType: 'image/jpeg', size: jpeg.length },
      });
      if (ticket.kind !== 'ok') throw new Error(ticket.kind);
      await storage.writeIntake(`preview/reviews/${reviewId}/${ticket.photoId}`, jpeg);
      const ingested = await ingestPhoto(ctx, {
        profileId: member.userId,
        reviewId,
        photoId: ticket.photoId,
      });
      if (ingested.kind !== 'ok') throw new Error(ingested.kind);
    }
    return { reviewId, member };
  }

  async function photos(reviewId: number) {
    const { data: rows, error } = await data.admin
      .from('review_images')
      .select('id, object_key, width, hidden_at, hidden_reason_code')
      .eq('review_id', reviewId)
      .order('sort_order');
    if (error) throw error;
    return rows as {
      id: number;
      object_key: string;
      width: number;
      hidden_at: string | null;
      hidden_reason_code: string | null;
    }[];
  }

  /** 配信側にある写真の幅 (写真ごとに 1 つ。webp の一番大きい段の名前から) */
  async function deliveredPhotos(): Promise<string[]> {
    try {
      const files = (await readdir(path.join(storage.root, 'public'), { recursive: true })).map(
        String
      );
      return [...new Set(files.filter(f => /\.(webp|avif)$/.test(f)).map(f => path.dirname(f)))];
    } catch {
      return [];
    }
  }

  async function screen(reviewId: number) {
    return screenSubmittedReview(reviewId, { screener, db: data.admin, storage });
  }

  it('写真 1 枚だけが問題の時、その写真だけが非公開になり、口コミは公開される。配信側には残りだけ', async () => {
    const { reviewId } = await pendingReviewWithPhotos(
      '楽しかった [hide-photo:2:personal_info]',
      [400, 500, 600]
    );

    await expect(screen(reviewId)).resolves.toMatchObject({
      kind: 'screened',
      status: 'published',
    });

    const rows = await photos(reviewId);
    expect(rows.map(row => [row.width, row.hidden_reason_code])).toEqual([
      [400, null],
      [500, 'personal_info'],
      [600, null],
    ]);
    expect(rows[1].hidden_at).not.toBeNull();
    const delivered = await deliveredPhotos();
    expect(delivered.sort()).toEqual(
      [rows[0].object_key, rows[2].object_key].map(key => path.normalize(key)).sort()
    );
    // 配信側の物は保管側と同じ中身 (段ごと・形式ごと)
    const key = `${rows[0].object_key}/400.webp`;
    expect(await storage.readPublic(key)).toEqual(await storage.readStored(key));
  });

  it('非公開の写真と理由は、本人のマイページの一覧にだけ出る', async () => {
    const { reviewId, member } = await pendingReviewWithPhotos(
      '楽しかった [hide-photo:2:personal_info]',
      [400, 500]
    );
    await screen(reviewId);

    const [item] = await listOwnReviews(data.admin, member.userId, storage);
    expect(item.hiddenPhotos).toEqual([
      {
        id: (await photos(reviewId))[1].id,
        src: expect.stringContaining('/320.webp'),
        reasonCode: 'personal_info',
      },
    ]);
    // ほかの会員の一覧には出ない
    const other = await data.createMember();
    expect(await listOwnReviews(data.admin, other.userId, storage)).toEqual([]);
  });

  it('迷った写真があれば、本文が通っても公開せず BOSS の確認待ちにする。配信側には何も無い', async () => {
    const { reviewId } = await pendingReviewWithPhotos('普通の感想 [unsure-photo:1]', [400]);

    await expect(screen(reviewId)).resolves.toMatchObject({
      kind: 'screened',
      status: 'needs_review',
    });
    expect(await deliveredPhotos()).toEqual([]);
  });

  it('公開の後に編集して差し戻し・削除・写真を外すと、配信側から消える', async () => {
    const { reviewId, member } = await pendingReviewWithPhotos('楽しかった', [400, 500]);
    await screen(reviewId);
    expect(await deliveredPhotos()).toHaveLength(2);

    // 写真を外す (行が消える) → その写真の物だけが消える
    const [first, second] = await photos(reviewId);
    await removePhoto(ctx, { profileId: member.userId, reviewId, photoId: first.id });
    expect(await deliveredPhotos()).toEqual([path.normalize(second.object_key)]);

    // 本文を変えて出し直す (投稿者の編集ならトリガが審査中に戻す。ここは service role なので状態も書く) → 差し戻し → 配信側から消える
    const { error } = await data.admin
      .from('reviews')
      .update({
        body: '宣伝です [reject:spam]',
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', reviewId);
    if (error) throw error;
    await expect(screen(reviewId)).resolves.toMatchObject({ status: 'rejected' });
    expect(await deliveredPhotos()).toEqual([]);

    // もう一度公開してから論理削除 → 消える
    await data.admin
      .from('reviews')
      .update({ body: '直しました', status: 'pending', submitted_at: new Date().toISOString() })
      .eq('id', reviewId);
    await screen(reviewId);
    expect(await deliveredPhotos()).toHaveLength(1);
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', reviewId);
    await syncPhotoDelivery({ db: data.admin, storage }, reviewId);
    expect(await deliveredPhotos()).toEqual([]);
  });

  it('非公開の印は、次の審査で問題が無ければ外れる', async () => {
    const { reviewId } = await pendingReviewWithPhotos('楽しかった [hide-photo:1:abuse]', [400]);
    await screen(reviewId);
    expect((await photos(reviewId))[0].hidden_reason_code).toBe('abuse');

    await data.admin
      .from('reviews')
      .update({
        body: '写真を直しました',
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', reviewId);
    await screen(reviewId);
    expect((await photos(reviewId))[0]).toMatchObject({
      hidden_at: null,
      hidden_reason_code: null,
    });
    expect(await deliveredPhotos()).toHaveLength(1);
  });

  it('審査の間に出し直された時は、古い審査の結果で状態も写真の印も書かない', async () => {
    const { reviewId } = await pendingReviewWithPhotos('楽しかった [hide-photo:1:abuse]', [400]);
    // 審査器の呼び出しの間に、投稿者が内容を直して出し直したことにする
    const racing = {
      async screen(input: Parameters<typeof screener.screen>[0]) {
        await data.admin
          .from('reviews')
          .update({ submitted_at: new Date(Date.now() + 1000).toISOString() })
          .eq('id', reviewId);
        return screener.screen(input);
      },
    };

    await expect(
      screenSubmittedReview(reviewId, { screener: racing, db: data.admin, storage })
    ).resolves.toEqual({ kind: 'skipped', reason: 'superseded' });
    expect((await photos(reviewId))[0]).toMatchObject({
      hidden_at: null,
      hidden_reason_code: null,
    });
    expect(await deliveredPhotos()).toEqual([]);
  });

  it('審査の間に写真が足された時は書かず、足した写真も含めた次の審査で公開する', async () => {
    const { reviewId, member } = await pendingReviewWithPhotos('楽しかった', [400]);
    const jpeg = await sharp({
      create: { width: 500, height: 300, channels: 3, background: '#c84' },
    })
      .jpeg()
      .toBuffer();
    const racing = {
      async screen(input: Parameters<typeof screener.screen>[0]) {
        // 審査器の呼び出しの間に、写真をもう 1 枚足す (この審査は見ていない)
        const ticket = await requestPhotoUpload(ctx, {
          profileId: member.userId,
          reviewId,
          file: { contentType: 'image/jpeg', size: jpeg.length },
        });
        if (ticket.kind !== 'ok') throw new Error(ticket.kind);
        await storage.writeIntake(`preview/reviews/${reviewId}/${ticket.photoId}`, jpeg);
        const added = await ingestPhoto(ctx, {
          profileId: member.userId,
          reviewId,
          photoId: ticket.photoId,
        });
        // 審査中の口コミに足した写真は、審査をもう一度走らせる印が付く
        expect(added).toMatchObject({ kind: 'ok', needsScreening: true });
        return screener.screen(input);
      },
    };

    await expect(
      screenSubmittedReview(reviewId, { screener: racing, db: data.admin, storage })
    ).resolves.toEqual({ kind: 'skipped', reason: 'superseded' });
    expect(await deliveredPhotos()).toEqual([]);

    await expect(screen(reviewId)).resolves.toMatchObject({ status: 'published' });
    expect(await deliveredPhotos()).toHaveLength(2);
  });

  it('同期の途中で公開でなくなったら、写した物を消す', async () => {
    const { reviewId } = await pendingReviewWithPhotos('楽しかった', [400]);
    await screen(reviewId);
    expect(await deliveredPhotos()).toHaveLength(1);

    // 公開中のまま写し始め、写している間に論理削除されたことにする
    const slow = {
      ...storage,
      async publish(keys: string[]) {
        await storage.publish(keys);
        await data.admin
          .from('reviews')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', reviewId);
      },
    };
    await syncPhotoDelivery({ db: data.admin, storage: slow }, reviewId);
    expect(await deliveredPhotos()).toEqual([]);
  });

  it('写真を読めない時は審査の失敗にして、公開しない', async () => {
    const { reviewId } = await pendingReviewWithPhotos('楽しかった', [400]);
    await expect(
      screenSubmittedReview(reviewId, { screener, db: data.admin, storage: null })
    ).resolves.toMatchObject({ status: 'needs_review' });
    const { data: review } = await data.admin
      .from('reviews')
      .select('reason_code')
      .eq('id', reviewId)
      .single();
    expect(review).toEqual({ reason_code: 'ai_failure' });
  });

  it('会員は自分の写真の非公開の印を書き換えられない', async () => {
    const { reviewId, member } = await pendingReviewWithPhotos(
      '楽しかった [hide-photo:1:spam]',
      [400]
    );
    await screen(reviewId);
    const { signInAsMember } = await import('@/test-support/test-data');
    const client = await signInAsMember(member);
    const [photo] = await photos(reviewId);
    const { error } = await client
      .from('review_images')
      .update({ hidden_at: null, hidden_reason_code: null })
      .eq('id', photo.id);
    expect(error?.code).toBe('42501');
  });
});
