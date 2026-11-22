import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  anonClient,
  createTestDataScope,
  jstDate,
  signInAsMember,
  type TestDataScope,
} from '@/test-support/test-data';

/**
 * 開催ごとの口コミの集計 (occurrence_review_stats) と「参考になった」(one-more-time #165) を
 * ローカルの実 DB で確かめる。
 */
describe('口コミの集計と参考になった', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data.cleanup();
  });

  async function ongoingOccurrence() {
    const event = await data.createEvent();
    return data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
  }

  /** 公開中の口コミを 1 件作る (投稿者の RLS で入れ、審査の結果の代わりに service role で公開にする) */
  async function publishedReview(occurrenceId: number, fields: Record<string, unknown>) {
    const member = await data.createMember();
    const client = await signInAsMember(member);
    const { data: row, error } = await client
      .from('reviews')
      .insert({
        occurrence_id: occurrenceId,
        user_id: member.userId,
        visited_on: jstDate(-1),
        ...fields,
      })
      .select('id')
      .single();
    if (error) throw error;
    const published = await data.admin
      .from('reviews')
      .update({ status: 'published' })
      .eq('id', row.id);
    if (published.error) throw published.error;
    return { id: row.id as number, member, client };
  }

  /** ログインしていない人が読む集計を「次元:値 → 件数」にする */
  async function stats(occurrenceId: number) {
    const { data: rows, error } = await anonClient()
      .from('occurrence_review_stats')
      .select('dimension, value, count')
      .eq('occurrence_id', occurrenceId);
    if (error) throw error;
    return Object.fromEntries(
      (rows ?? []).map(row => [`${row.dimension}:${row.value}`, row.count])
    );
  }

  it('公開中の口コミだけを、星・参加のしかた・費用の帯ごとに数える', async () => {
    const occ = await ongoingOccurrence();
    await publishedReview(occ.id, {
      rating: 5,
      attendance: 'walk_in',
      food_cost_band: '2000_3000',
    });
    await publishedReview(occ.id, { rating: 5, attendance: 'queue' });
    // 審査中は数えない
    const member = await data.createMember();
    const client = await signInAsMember(member);
    const pending = await client.from('reviews').insert({
      occurrence_id: occ.id,
      user_id: member.userId,
      rating: 1,
      visited_on: jstDate(-1),
    });
    if (pending.error) throw pending.error;

    expect(await stats(occ.id)).toEqual({
      'rating:5': 2,
      'attendance:walk_in': 1,
      'attendance:queue': 1,
      'food_cost_band:2000_3000': 1,
    });
  });

  it('編集で審査中に戻る・非公開・削除で集計から外れる', async () => {
    const occ = await ongoingOccurrence();
    const edited = await publishedReview(occ.id, { rating: 4, goods_cost_band: 'under_5000' });
    const hidden = await publishedReview(occ.id, { rating: 3 });
    const deleted = await publishedReview(occ.id, { rating: 2 });
    expect(await stats(occ.id)).toMatchObject({ 'rating:4': 1, 'rating:3': 1, 'rating:2': 1 });

    await edited.client.from('reviews').update({ rating: 5 }).eq('id', edited.id);
    await data.admin.from('reviews').update({ status: 'hidden' }).eq('id', hidden.id);
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deleted.id);

    expect(await stats(occ.id)).toEqual({});
  });

  it('「参考になった」は公開中の口コミにだけ付けられ、取り消せる。件数に反映される', async () => {
    const occ = await ongoingOccurrence();
    const review = await publishedReview(occ.id, { rating: 4 });
    const reader = await data.createMember();
    const readerClient = await signInAsMember(reader);

    const added = await readerClient
      .from('review_helpful')
      .insert({ review_id: review.id, user_id: reader.userId });
    expect(added.error).toBeNull();
    const count = async () =>
      (await anonClient().from('reviews').select('helpful_count').eq('id', review.id).single()).data
        ?.helpful_count;
    expect(await count()).toBe(1);
    // 件数の更新は内容の変更ではない (審査中に戻さず、最終編集日も入れない)
    const { data: after } = await data.admin
      .from('reviews')
      .select('status, edited_at')
      .eq('id', review.id)
      .single();
    expect(after).toEqual({ status: 'published', edited_at: null });

    const removed = await readerClient
      .from('review_helpful')
      .delete()
      .eq('review_id', review.id)
      .eq('user_id', reader.userId);
    expect(removed.error).toBeNull();
    expect(await count()).toBe(0);
  });

  it('審査中の口コミ (本人の物を含む) には「参考になった」を付けられない', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const client = await signInAsMember(member);
    const { data: pending, error } = await client
      .from('reviews')
      .insert({ occurrence_id: occ.id, user_id: member.userId, rating: 3, visited_on: jstDate(-1) })
      .select('id')
      .single();
    if (error) throw error;

    const attempt = await client
      .from('review_helpful')
      .insert({ review_id: pending.id, user_id: member.userId });

    // action はこのコードの時だけ「公開中の口コミにだけ押せます」を返す (ほかは想定外として Sentry へ)
    expect(attempt.error?.code).toBe('42501');
  });
});
