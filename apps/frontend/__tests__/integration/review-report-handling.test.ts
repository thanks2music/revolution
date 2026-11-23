/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getReviewForModeration, type ModerationDeps } from '@revolution/reviews/moderation';
import { handleReviewReports, listReportQueue } from '@revolution/reviews/reports';
import {
  anonClient,
  createTestDataScope,
  signInAsMember,
  type TestDataScope,
  type TestMember,
} from '@/test-support/test-data';

/**
 * BOSS の通報の処理 (one-more-time #168、migration 0029)。admin の会員のログインで admin の関数を呼ぶ。
 * 通報は公開サイトと同じく service role の submit_review_report で作る。写真の置き場所は使わない (storage: null)
 */
describe('BOSS の通報の処理', () => {
  let data: TestDataScope;
  let boss: TestMember;
  let bossDb: SupabaseClient;

  beforeEach(async () => {
    data = createTestDataScope();
    boss = await data.createMember({ admin: true });
    bossDb = await signInAsMember(boss);
  });
  afterEach(async () => {
    await data.cleanup();
  });

  const deps = (adminDb: SupabaseClient = bossDb): ModerationDeps => ({
    adminDb,
    serviceDb: data.admin,
    storage: null,
  });

  /** 公開中の口コミに写真を n 枚付け、端末から理由ごとに通報する */
  async function reportedReview(reasons: string[] = ['spam'], photos = 0) {
    const review = await data.createReview();
    const photoIds: number[] = [];
    for (let i = 0; i < photos; i++) {
      const { data: row, error } = await data.admin
        .from('review_images')
        .insert({
          review_id: review.reviewId,
          object_key: `preview/reviews/${review.reviewId}/photo-${i}-${randomUUID()}`,
          width: 800,
          height: 600,
          variant_widths: [320, 720],
        })
        .select('id')
        .single();
      if (error) throw error;
      photoIds.push(row.id as number);
    }
    // 写真を足すと審査中に戻る (0019 のトリガ) ので、公開に戻す (審査を通った後の口コミの形)
    if (photos > 0) {
      const { error } = await data.admin
        .from('reviews')
        .update({ status: 'published' })
        .eq('id', review.reviewId);
      if (error) throw error;
    }
    for (const reason of reasons) {
      const { error } = await data.admin.rpc('submit_review_report', {
        p_review_id: review.reviewId,
        p_reason_code: reason,
        p_reporter_profile_id: null,
        p_reporter_device_id: randomUUID(),
      });
      if (error) throw error;
    }
    return { ...review, photoIds };
  }

  /** 画面と同じく、口コミの確認を読んでから処理する */
  async function seen(reviewId: number) {
    const detail = await getReviewForModeration(bossDb, null, reviewId);
    if (detail.kind !== 'ok') throw new Error(detail.kind);
    return detail.review;
  }

  async function reviewRow(reviewId: number) {
    const { data: row, error } = await data.admin
      .from('reviews')
      .select('status, reason_code, reason_note, has_spoiler, edited_at')
      .eq('id', reviewId)
      .single();
    if (error) throw error;
    return row;
  }

  async function handle(
    reviewId: number,
    outcome:
      | {
          outcome: 'hide';
          reasonCode: 'resale' | 'not_attended' | 'spam';
          reasonNote: string | null;
        }
      | { outcome: 'keep' },
    changes: { hasSpoiler?: boolean; hidePhoto?: number } = {}
  ) {
    const review = await seen(reviewId);
    return handleReviewReports(deps(), {
      reviewId,
      submittedAt: review.review.submitted_at!,
      reportIds: review.openReports.map(report => report.id),
      hasSpoiler: changes.hasSpoiler ?? review.review.has_spoiler,
      photos: review.photos.map(photo =>
        photo.id === changes.hidePhoto
          ? { id: photo.id, hide: true, reason: 'photo_reposted' as const }
          : { id: photo.id, hide: false }
      ),
      ...outcome,
    });
  }

  it('一覧は通報のある口コミを、件数と理由ごとの件数 (多い順) で返す。通報した人は返さない', async () => {
    const { reviewId } = await reportedReview(['spam', 'resale', 'resale']);

    const queue = await listReportQueue(bossDb);
    if (queue.kind !== 'ok') throw new Error(queue.kind);
    const item = queue.items.find(entry => entry.reviewId === reviewId);
    expect(item).toMatchObject({
      status: 'published',
      reportCount: 3,
      reasons: [
        { code: 'resale', count: 2 },
        { code: 'spam', count: 1 },
      ],
    });
    expect(JSON.stringify(item)).not.toMatch(/reporter|device/);
  });

  it('非公開にすると、理由とひとことが入り、通報が閉じ、閲覧者から消える。本人が直すと審査中に戻る', async () => {
    const { reviewId, author } = await reportedReview(['resale', 'resale']);

    expect(
      await handle(reviewId, {
        outcome: 'hide',
        reasonCode: 'resale',
        reasonNote: '譲渡の呼びかけを消してください',
      })
    ).toEqual({ kind: 'applied', action: 'hidden' });

    expect(await reviewRow(reviewId)).toMatchObject({
      status: 'hidden',
      reason_code: 'resale',
      reason_note: '譲渡の呼びかけを消してください',
    });
    expect((await seen(reviewId)).openReports).toHaveLength(0);
    const queue = await listReportQueue(bossDb);
    expect(queue.kind === 'ok' && queue.items.some(item => item.reviewId === reviewId)).toBe(false);
    const history = (await seen(reviewId)).history.at(-1);
    expect(history).toMatchObject({ actor: 'admin', action: 'hidden', to_status: 'hidden' });
    const { data: visible } = await anonClient().from('reviews').select('id').eq('id', reviewId);
    expect(visible).toEqual([]);

    // 本人は理由を読め、本文を直すと審査中に戻る
    const authorDb = await signInAsMember(author);
    const own = await authorDb.from('reviews').select('status').eq('id', reviewId).single();
    expect(own.data?.status).toBe('hidden');
    const edit = await authorDb.from('reviews').update({ body: '直しました' }).eq('id', reviewId);
    expect(edit.error).toBeNull();
    expect(await reviewRow(reviewId)).toMatchObject({ status: 'pending', reason_code: null });
  });

  it('ネタバレの印と写真の非公開を当てると、公開のまま閉じる (審査中には戻らない)', async () => {
    const { reviewId, photoIds } = await reportedReview(['spoiler_unmarked', 'photo_reposted'], 2);

    // 最終編集日は変わらない (本人の編集ではない)
    const before = await reviewRow(reviewId);
    expect(
      await handle(reviewId, { outcome: 'keep' }, { hasSpoiler: true, hidePhoto: photoIds[1] })
    ).toEqual({ kind: 'applied', action: 'kept' });

    expect(await reviewRow(reviewId)).toMatchObject({
      status: 'published',
      has_spoiler: true,
      edited_at: before.edited_at,
    });
    const { data: photos } = await data.admin
      .from('review_images')
      .select('id, hidden_reason_code')
      .eq('review_id', reviewId)
      .order('id');
    expect(photos).toEqual([
      { id: photoIds[0], hidden_reason_code: null },
      { id: photoIds[1], hidden_reason_code: 'photo_reposted' },
    ]);
    expect((await seen(reviewId)).history.at(-1)).toMatchObject({
      action: 'kept',
      to_status: 'published',
    });
  });

  it('何も変えなければ「問題なし」で閉じる', async () => {
    const { reviewId } = await reportedReview(['other']);
    expect(await handle(reviewId, { outcome: 'keep' })).toEqual({
      kind: 'applied',
      action: 'dismissed',
    });
    expect((await reviewRow(reviewId)).status).toBe('published');
    expect((await seen(reviewId)).history.at(-1)).toMatchObject({ action: 'dismissed' });
  });

  it('画面を開いた後に来た通報は、閉じずに残す', async () => {
    const { reviewId } = await reportedReview(['spam']);
    const review = await seen(reviewId);
    await data.admin.rpc('submit_review_report', {
      p_review_id: reviewId,
      p_reason_code: 'abuse',
      p_reporter_profile_id: null,
      p_reporter_device_id: randomUUID(),
    });

    await handleReviewReports(deps(), {
      reviewId,
      submittedAt: review.review.submitted_at!,
      reportIds: review.openReports.map(report => report.id),
      hasSpoiler: false,
      photos: [],
      outcome: 'keep',
    });

    expect((await seen(reviewId)).openReports.map(report => report.reasonCode)).toEqual(['abuse']);
  });

  it('読んだ後に出し直された・写真が変わった口コミには書かない', async () => {
    const { reviewId } = await reportedReview(['spam'], 1);
    const review = await seen(reviewId);
    const base = {
      reviewId,
      submittedAt: review.review.submitted_at!,
      reportIds: review.openReports.map(report => report.id),
      hasSpoiler: false,
      outcome: 'keep' as const,
    };

    expect(await handleReviewReports(deps(), { ...base, photos: [] })).toEqual({
      kind: 'photos_changed',
    });
    expect(
      await handleReviewReports(deps(), {
        ...base,
        submittedAt: new Date(0).toISOString(),
        photos: review.photos.map(photo => ({ id: photo.id, hide: false })),
      })
    ).toEqual({ kind: 'superseded' });
    expect((await seen(reviewId)).openReports).toHaveLength(1);
  });

  it('公開でなくなった口コミは、変えずに閉じることだけができる', async () => {
    const { reviewId } = await reportedReview(['spam']);
    await data.admin.from('reviews').update({ status: 'pending' }).eq('id', reviewId);

    expect(
      await handle(reviewId, { outcome: 'hide', reasonCode: 'spam', reasonNote: null })
    ).toEqual({
      kind: 'not_published',
    });
    expect(await handle(reviewId, { outcome: 'keep' }, { hasSpoiler: true })).toEqual({
      kind: 'not_published',
    });
    expect(await handle(reviewId, { outcome: 'keep' })).toEqual({
      kind: 'applied',
      action: 'dismissed',
    });
    expect(await reviewRow(reviewId)).toMatchObject({ status: 'pending', has_spoiler: false });
  });

  it('見た通報がもう閉じていれば (別のタブで処理した)、何も書かない', async () => {
    const { reviewId } = await reportedReview(['spam']);
    const review = await seen(reviewId);
    const input = {
      reviewId,
      submittedAt: review.review.submitted_at!,
      reportIds: review.openReports.map(report => report.id),
      hasSpoiler: false,
      photos: [],
      outcome: 'keep' as const,
    };
    expect(await handleReviewReports(deps(), input)).toEqual({
      kind: 'applied',
      action: 'dismissed',
    });
    expect(await handleReviewReports(deps(), input)).toEqual({ kind: 'superseded' });
    expect(await handleReviewReports(deps(), { ...input, reportIds: [] })).toEqual({
      kind: 'superseded',
    });
    expect(
      (await seen(reviewId)).history.filter(entry => entry.action === 'dismissed')
    ).toHaveLength(1);
  });

  it('admin でない会員と anon は、通報の一覧も処理も使えない', async () => {
    const { reviewId } = await reportedReview(['spam']);
    const member = await signInAsMember(await data.createMember());
    for (const db of [member, anonClient()]) {
      expect(await listReportQueue(db).catch(error => error.code)).toEqual(
        db === member ? { kind: 'forbidden' } : '42501'
      );
    }
    const result = await handleReviewReports(deps(member), {
      reviewId,
      submittedAt: new Date().toISOString(),
      reportIds: [],
      hasSpoiler: false,
      photos: [],
      outcome: 'keep',
    });
    expect(result).toEqual({ kind: 'forbidden' });
  });

  it('非公開の理由は通報の 8 つから。問題なしには理由を付けられない', async () => {
    const { reviewId } = await reportedReview(['spam']);
    const review = await seen(reviewId);
    const call = (reason: string | null, outcome: string) =>
      bossDb.rpc('admin_handle_review_reports', {
        p_review_id: reviewId,
        p_submitted_at: review.review.submitted_at,
        p_report_ids: [],
        p_outcome: outcome,
        p_reason_code: reason,
        p_reason_note: null,
        p_has_spoiler: false,
        p_photo_marks: [],
      });
    expect((await call('ai_failure', 'hide')).error?.code).toBe('22023');
    expect((await call(null, 'hide')).error?.code).toBe('22023');
    expect((await call('spam', 'keep')).error?.code).toBe('22023');
  });
});
