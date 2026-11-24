/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requeueReview } from '@revolution/reviews/moderation';
import {
  loadReviewSummary,
  notifyAboutReview,
  type ReviewNotification,
  type ReviewNotifier,
} from '@revolution/reviews/notifications';
import { createFakeScreener } from '@revolution/reviews/screener/fake-screener';
import { createTestDataScope, signInAsMember, type TestDataScope } from '@/test-support/test-data';

/**
 * Slack の通知 (one-more-time #169)。本物の Postgres に対して、通知の文に使う口コミの読み取りと、
 * 通知の失敗で会員や BOSS の操作が失敗しないこと (受け入れ基準) を確かめる。Slack には送らない
 */
describe('Slack の通知', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });
  afterEach(async () => {
    await data.cleanup();
  });

  /** 送るたびに例外を投げる通知の口 (Slack が落ちている時の代わり) */
  function throwingNotifier(): ReviewNotifier & { calls: ReviewNotification[] } {
    const calls: ReviewNotification[] = [];
    return {
      enabled: true,
      calls,
      async notify(notification) {
        calls.push(notification);
        throw new Error('slack is down');
      },
    };
  }

  it('通知の文に使う中身 (表示名・企画名・会場・星・本文) を読む。消した口コミも読める', async () => {
    const author = await data.createMember();
    const { reviewId } = await data.createReview({ author, rating: 5, body: '最高でした' });
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', reviewId);

    const summary = await loadReviewSummary(data.admin, reviewId);

    expect(summary).toMatchObject({ reviewId, rating: 5, body: '最高でした' });
    expect(summary?.authorName).toBe(author.username);
    expect(summary?.eventName).toMatch(/^テスト企画/);
    expect(await loadReviewSummary(data.admin, 2_000_000_000)).toBeNull();
  });

  it('通知の口が例外を投げても、notifyAboutReview は例外を外へ出さない', async () => {
    const { reviewId } = await data.createReview();
    const notifier = throwingNotifier();

    await expect(
      notifyAboutReview({ notifier, db: data.admin }, reviewId, review => ({
        type: 'review_submitted',
        review,
      }))
    ).resolves.toBeUndefined();
    expect(notifier.calls.map(call => call.type)).toEqual(['review_submitted']);
  });

  it('「もう一度 AI にかける」は、通知が失敗しても審査の結果を書く (BOSS の操作は成功する)', async () => {
    const boss = await data.createMember({ admin: true });
    const bossDb: SupabaseClient = await signInAsMember(boss);
    const { reviewId } = await data.createReview({ status: 'pending', body: '迷う [unsure]' });
    // 確認待ちにしてから、もう一度 AI にかける (本文の目印を外して公開にさせる)
    const { data: row } = await data.admin
      .from('reviews')
      .update({ status: 'needs_review', body: '楽しかった' })
      .eq('id', reviewId)
      .select('submitted_at')
      .single();
    const notifier = throwingNotifier();

    const outcome = await requeueReview(
      {
        adminDb: bossDb,
        serviceDb: data.admin,
        storage: null,
        screener: createFakeScreener(),
        notifier,
      },
      { reviewId, submittedAt: row!.submitted_at as string }
    );

    expect(outcome).toMatchObject({
      kind: 'applied',
      screening: { kind: 'screened', status: 'published', aiFailure: false },
    });
    const { data: after } = await data.admin
      .from('reviews')
      .select('status')
      .eq('id', reviewId)
      .single();
    expect(after?.status).toBe('published');
    expect(notifier.calls).toEqual([
      expect.objectContaining({ type: 'review_screened', status: 'published', aiFailure: false }),
    ]);
  });
});
