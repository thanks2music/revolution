import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createFakeScreener } from '@/lib/reviews/screener/fake-screener';
import type { ReviewScreener } from '@/lib/reviews/screener/types';
import { screenSubmittedReview } from '@/lib/reviews/operations';
import {
  anonClient,
  createTestDataScope,
  jstDate,
  signInAsMember,
  type TestDataScope,
} from '@/test-support/test-data';

/**
 * 提出された口コミの審査 (操作の層) をローカルの実 DB で確かめる。審査器は偽物
 * (本文の目印で結果が決まる) を使い、本物の Gemini は呼ばない。
 */
describe('提出された口コミの審査', () => {
  let data: TestDataScope | undefined;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data?.cleanup();
  });

  /** 開催中の開催に、会員が口コミを提出する */
  async function submitted(body: string) {
    const event = await data!.createEvent();
    const occurrence = await data!.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const member = await data!.createMember();
    const client = await signInAsMember(member);
    const { data: review, error } = await client
      .from('reviews')
      .insert({ occurrence_id: occurrence.id, user_id: member.userId, rating: 4, visited_on: jstDate(-1), body })
      .select('id')
      .single();
    if (error) throw error;
    return { reviewId: review.id as number, occurrenceId: occurrence.id };
  }

  async function row(reviewId: number) {
    const { data: review, error } = await data!.admin
      .from('reviews')
      .select('status, reason_code, ai_reason, ai_error, ai_model, ai_screened_at')
      .eq('id', reviewId)
      .single();
    if (error) throw error;
    return review;
  }

  it('問題がなければ公開にし、ログインしていない人にも見える', async () => {
    const { reviewId, occurrenceId } = await submitted('パフェが美味しかった');

    const outcome = await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    expect(outcome).toEqual({ kind: 'screened', status: 'published', occurrenceId });
    expect(await row(reviewId)).toMatchObject({ status: 'published', reason_code: null, ai_model: 'fake-screener' });
    const { data: visible } = await anonClient().from('reviews').select('id').eq('id', reviewId);
    expect(visible).toHaveLength(1);
  });

  it('当たる本文は差し戻し、理由を残す', async () => {
    const { reviewId } = await submitted('[reject:resale] 缶バッジ譲ります');

    await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    expect(await row(reviewId)).toMatchObject({ status: 'rejected', reason_code: 'resale', ai_reason: 'fake: resale' });
  });

  it('AI が迷えば BOSS の確認待ちにする', async () => {
    const { reviewId } = await submitted('[unsure] どうだろう');

    await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    expect(await row(reviewId)).toMatchObject({ status: 'needs_review', reason_code: null });
  });

  it('審査に失敗したら「AI 審査の失敗」で確認待ちにする', async () => {
    const { reviewId } = await submitted('[fail]');

    await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    const review = await row(reviewId);
    expect(review).toMatchObject({ status: 'needs_review', reason_code: 'ai_failure', ai_error: 'fake failure' });
    expect(review.ai_screened_at).not.toBeNull();
  });

  it('審査中でない口コミには何もしない (二重の実行)', async () => {
    const { reviewId } = await submitted('パフェが美味しかった');
    await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    const second = await screenSubmittedReview(reviewId, { screener: createFakeScreener(), db: data!.admin });

    expect(second).toEqual({ kind: 'skipped', reason: 'not_pending' });
  });

  it('審査の間に提出し直されたら、古い本文の結果で上書きしない', async () => {
    const { reviewId } = await submitted('パフェが美味しかった');
    // 審査の途中で、提出し直した時と同じく submitted_at が進む
    const racing: ReviewScreener = {
      async screen(input) {
        await data!.admin
          .from('reviews')
          .update({ submitted_at: new Date(Date.now() + 1_000).toISOString() })
          .eq('id', reviewId);
        return createFakeScreener().screen(input);
      },
    };

    const outcome = await screenSubmittedReview(reviewId, { screener: racing, db: data!.admin });

    expect(outcome).toEqual({ kind: 'skipped', reason: 'superseded' });
    expect(await row(reviewId)).toMatchObject({ status: 'pending' });
  });

  it('無い口コミには何もしない', async () => {
    await expect(
      screenSubmittedReview(2_147_483_000, { screener: createFakeScreener(), db: data!.admin }),
    ).resolves.toEqual({ kind: 'skipped', reason: 'not_found' });
  });
});
