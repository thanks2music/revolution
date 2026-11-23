/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import {
  decideReview,
  getReviewForModeration,
  listReviewQueue,
  requeueReview,
  type ModerationDeps,
} from '@revolution/reviews/moderation';
import { screenSubmittedReview } from '@revolution/reviews/operations';
import {
  ingestPhoto,
  requestPhotoUpload,
  type PhotoContext,
} from '@revolution/reviews/photos/operations';
import { createFakePhotoStorage, type FakePhotoStorage } from '@revolution/reviews/photos/storage';
import { createFakeScreener } from '@revolution/reviews/screener/fake-screener';
import {
  anonClient,
  createTestDataScope,
  jstDate,
  signInAsMember,
  type TestDataScope,
  type TestMember,
} from '@/test-support/test-data';

/**
 * BOSS の操作 (one-more-time #167、migration 0026)。本物の Postgres・RLS・トリガに対して、admin の会員
 * (app_metadata.role = 'admin') のログインで admin の関数を呼ぶ。審査器と写真の置き場所は偽物。
 */
describe('BOSS の操作', () => {
  let data: TestDataScope;
  let storage: FakePhotoStorage;
  let ctx: PhotoContext;
  let boss: TestMember;
  let bossDb: SupabaseClient;
  const screener = createFakeScreener();

  beforeEach(async () => {
    data = createTestDataScope();
    storage = createFakePhotoStorage(
      await mkdtemp(path.join(os.tmpdir(), 'review-moderation-it-'))
    );
    ctx = { db: data.admin, storage, prefix: 'preview/' };
    boss = await data.createMember({ admin: true });
    bossDb = await signInAsMember(boss);
  });

  afterEach(async () => {
    await data.cleanup();
    await rm(storage.root, { recursive: true, force: true });
  });

  const deps = (adminDb: SupabaseClient = bossDb): ModerationDeps => ({
    adminDb,
    serviceDb: data.admin,
    storage,
  });

  /** 写真を n 枚付けて提出し、偽の審査器で審査する (本文の目印で結果が決まる) */
  async function screenedReview(body: string, photos = 0) {
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
    for (let i = 0; i < photos; i++) {
      const jpeg = await sharp({
        create: { width: 400 + i, height: 300, channels: 3, background: '#48c' },
      })
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
    await screenSubmittedReview(reviewId, { screener, db: data.admin, storage });
    return { reviewId, member };
  }

  async function reviewRow(reviewId: number) {
    const { data: row, error } = await data.admin
      .from('reviews')
      .select('status, reason_code, reason_note, submitted_at, ai_reason')
      .eq('id', reviewId)
      .single();
    if (error) throw error;
    return row as {
      status: string;
      reason_code: string | null;
      reason_note: string | null;
      submitted_at: string;
      ai_reason: string | null;
    };
  }

  async function photoRows(reviewId: number) {
    const { data: rows, error } = await data.admin
      .from('review_images')
      .select('id, hidden_reason_code')
      .eq('review_id', reviewId)
      .order('sort_order');
    if (error) throw error;
    return rows as { id: number; hidden_reason_code: string | null }[];
  }

  async function moderationEvents(reviewId: number) {
    const detail = await getReviewForModeration(bossDb, null, reviewId);
    if (detail.kind !== 'ok') throw new Error(detail.kind);
    return detail.review.history;
  }

  async function deliveredCount(): Promise<number> {
    try {
      const files = (await readdir(path.join(storage.root, 'public'), { recursive: true })).map(
        String
      );
      return new Set(files.filter(f => f.endsWith('.webp')).map(f => path.dirname(f))).size;
    } catch {
      return 0;
    }
  }

  describe('入れるのは admin だけ', () => {
    it('admin でない会員は、一覧・詳細・公開・差し戻し・もう一度 AI のどれも forbidden', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]');
      const member = await signInAsMember(await data.createMember());
      const { submitted_at } = await reviewRow(reviewId);

      await expect(listReviewQueue(member)).resolves.toEqual({ kind: 'forbidden' });
      await expect(getReviewForModeration(member, storage, reviewId)).resolves.toEqual({
        kind: 'forbidden',
      });
      await expect(
        decideReview(deps(member), {
          reviewId,
          submittedAt: submitted_at,
          decision: 'publish',
          photos: [],
        })
      ).resolves.toEqual({ kind: 'forbidden' });
      await expect(
        requeueReview({ ...deps(member), screener }, { reviewId, submittedAt: submitted_at })
      ).resolves.toEqual({ kind: 'forbidden' });
      expect((await reviewRow(reviewId)).status).toBe('needs_review');
    });

    it('ログインしていない利用者は関数を呼べず、判断の記録の表も読めない', async () => {
      const anon = anonClient();
      const { error } = await anon.rpc('admin_list_review_queue', { p_stuck_minutes: 30 });
      expect(error?.code).toBe('42501');
      const events = await anon.from('review_moderation_events').select('id');
      expect(events.error?.code).toBe('42501');
    });

    it('会員も判断の記録の表を直接は読めない (admin の関数経由だけ)', async () => {
      const events = await bossDb.from('review_moderation_events').select('id');
      expect(events.error?.code).toBe('42501');
    });
  });

  describe('確認待ちの一覧', () => {
    it('AI が迷った・AI の審査に失敗した・審査中のまま 30 分以上の口コミが古い順に出る。公開や新しい審査中は出ない', async () => {
      const unsure = await screenedReview('迷う [unsure]');
      const published = await screenedReview('楽しかった');
      // AI の審査に失敗した物: 確認待ちと理由 ai_failure を直接書く
      const failed = await screenedReview('迷う [unsure]');
      await data.admin
        .from('reviews')
        .update({ reason_code: 'ai_failure' })
        .eq('id', failed.reviewId);
      // 審査中のまま止まった物 (40 分前に提出) と、出したばかりの審査中
      const stuck = await screenedReview('迷う [unsure]');
      await data.admin
        .from('reviews')
        .update({
          status: 'pending',
          reason_code: null,
          submitted_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        })
        .eq('id', stuck.reviewId);
      const fresh = await screenedReview('迷う [unsure]');
      await data.admin
        .from('reviews')
        .update({ status: 'pending', reason_code: null })
        .eq('id', fresh.reviewId);

      const queue = await listReviewQueue(bossDb);
      if (queue.kind !== 'ok') throw new Error(queue.kind);
      const mine = queue.items.filter(item =>
        [unsure, published, failed, stuck, fresh].some(r => r.reviewId === item.reviewId)
      );
      expect(mine.map(item => [item.reviewId, item.kind])).toEqual([
        [stuck.reviewId, 'stuck'],
        [unsure.reviewId, 'unsure'],
        [failed.reviewId, 'ai_failure'],
      ]);
      expect(mine[1].eventName).toMatch(/テスト企画/);
    });
  });

  describe('口コミの確認', () => {
    it('本文・訪問日・AI の理由と、写真 (非公開の印つき、短時間だけ有効な URL)、判断の記録が見える', async () => {
      const { reviewId } = await screenedReview('写真が怪しい [unsure][hide-photo:2:spam]', 2);
      const detail = await getReviewForModeration(bossDb, storage, reviewId);
      if (detail.kind !== 'ok') throw new Error(detail.kind);

      expect(detail.review.review).toMatchObject({
        status: 'needs_review',
        visited_on: jstDate(-1),
        ai_reason: expect.any(String),
      });
      expect(detail.review.photos.map(photo => photo.hiddenReason)).toEqual([null, 'spam']);
      expect(detail.review.photos[0].src).toContain('/api/dev/review-photos/stored/');
      expect(detail.review.history).toMatchObject([
        { actor: 'ai', action: 'screened', from_status: 'pending', to_status: 'needs_review' },
      ]);
    });

    it('無い口コミ・削除した口コミは not_found', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]');
      await data.admin
        .from('reviews')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', reviewId);
      await expect(getReviewForModeration(bossDb, storage, reviewId)).resolves.toEqual({
        kind: 'not_found',
      });
    });
  });

  describe('公開・差し戻し', () => {
    it('写真 1 枚を理由つきで非公開にして公開すると、残りの写真だけが配信側に写り、記録に BOSS が残る', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]', 2);
      const [first, second] = await photoRows(reviewId);
      const { submitted_at } = await reviewRow(reviewId);

      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: submitted_at,
          decision: 'publish',
          photos: [
            { id: first.id, hide: false, reason: null },
            { id: second.id, hide: true, reason: 'personal_info' },
          ],
        })
      ).resolves.toEqual({ kind: 'applied' });

      expect(await reviewRow(reviewId)).toMatchObject({ status: 'published', reason_code: null });
      expect((await photoRows(reviewId)).map(photo => photo.hidden_reason_code)).toEqual([
        null,
        'personal_info',
      ]);
      expect(await deliveredCount()).toBe(1);
      const history = await moderationEvents(reviewId);
      expect(history.at(-1)).toMatchObject({
        actor: 'admin',
        action: 'published',
        from_status: 'needs_review',
        to_status: 'published',
      });
      // 記録に BOSS のユーザーの ID が残る (表は admin の関数でしか読めないので、service role は使えない)
      const { data: raw } = await bossDb.rpc('admin_get_review', { p_review_id: reviewId });
      const events = (raw as { events: { actor_user_id: string | null }[] }).events;
      expect(events.at(-1)?.actor_user_id).toBe(boss.userId);
    });

    it('差し戻すと理由と補足が口コミに残り、配信側には何も無い', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]', 1);
      const [photo] = await photoRows(reviewId);
      const { submitted_at } = await reviewRow(reviewId);

      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: submitted_at,
          decision: 'reject',
          reasonCode: 'resale',
          reasonNote: '  譲渡の呼びかけを外して出し直してください  ',
          photos: [{ id: photo.id, hide: false, reason: null }],
        })
      ).resolves.toEqual({ kind: 'applied' });

      expect(await reviewRow(reviewId)).toMatchObject({
        status: 'rejected',
        reason_code: 'resale',
        reason_note: '譲渡の呼びかけを外して出し直してください',
      });
      expect(await deliveredCount()).toBe(0);
      expect((await moderationEvents(reviewId)).at(-1)).toMatchObject({
        actor: 'admin',
        action: 'rejected',
        reason_code: 'resale',
      });
    });

    it('読んだ後に投稿者が出し直していたら superseded、写真が変わっていたら photos_changed で、何も書かない', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]', 1);
      const [photo] = await photoRows(reviewId);
      const { submitted_at } = await reviewRow(reviewId);

      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: new Date(Date.parse(submitted_at) - 1000).toISOString(),
          decision: 'publish',
          photos: [{ id: photo.id, hide: false, reason: null }],
        })
      ).resolves.toEqual({ kind: 'superseded' });
      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: submitted_at,
          decision: 'publish',
          photos: [],
        })
      ).resolves.toEqual({ kind: 'photos_changed' });
      expect((await reviewRow(reviewId)).status).toBe('needs_review');
      expect(await moderationEvents(reviewId)).toHaveLength(1);
    });

    it('非公開にする写真に理由が無い・差し戻しの理由が審査の 4 種でない時は、DB が断る', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]', 1);
      const [photo] = await photoRows(reviewId);
      const { submitted_at } = await reviewRow(reviewId);

      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: submitted_at,
          decision: 'publish',
          photos: [{ id: photo.id, hide: true, reason: null }],
        })
      ).rejects.toMatchObject({ code: '22023' });
      await expect(
        decideReview(deps(), {
          reviewId,
          submittedAt: submitted_at,
          // @ts-expect-error ai_failure は差し戻しの理由にできない
          reasonCode: 'ai_failure',
          decision: 'reject',
          reasonNote: null,
          photos: [{ id: photo.id, hide: false, reason: null }],
        })
      ).rejects.toMatchObject({ code: '22023' });
      expect((await reviewRow(reviewId)).status).toBe('needs_review');
    });
  });

  describe('もう一度 AI にかける', () => {
    it('審査中に戻して審査し直し、記録に「戻した」と「審査した」が順に残る', async () => {
      const { reviewId } = await screenedReview('迷う [unsure]');
      // 投稿者の手で本文が直ったことにする (審査器の目印を外す。状態は service role なので変わらない)
      await data.admin.from('reviews').update({ body: '楽しかった' }).eq('id', reviewId);
      const { submitted_at } = await reviewRow(reviewId);

      const outcome = await requeueReview(
        { ...deps(), screener },
        { reviewId, submittedAt: submitted_at }
      );
      expect(outcome).toMatchObject({
        kind: 'applied',
        screening: { kind: 'screened', status: 'published' },
      });
      expect((await moderationEvents(reviewId)).map(event => event.action)).toEqual([
        'screened',
        'requeued',
        'screened',
      ]);
    });

    it('公開中・差し戻しの口コミは戻さない (superseded)', async () => {
      const { reviewId } = await screenedReview('楽しかった');
      const { submitted_at } = await reviewRow(reviewId);
      await expect(
        requeueReview({ ...deps(), screener }, { reviewId, submittedAt: submitted_at })
      ).resolves.toEqual({ kind: 'superseded' });
    });
  });

  it('判断の記録は書き換えも消去もできない (service role でも)', async () => {
    const { reviewId } = await screenedReview('楽しかった');
    const update = await data.admin
      .from('review_moderation_events')
      .update({ to_status: 'rejected' })
      .eq('review_id', reviewId);
    expect(update.error?.code).toBe('42501');
    const remove = await data.admin
      .from('review_moderation_events')
      .delete()
      .eq('review_id', reviewId);
    expect(remove.error?.code).toBe('42501');
    expect(await moderationEvents(reviewId)).toHaveLength(1);
  });
});
