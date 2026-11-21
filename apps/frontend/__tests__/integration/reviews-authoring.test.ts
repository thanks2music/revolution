import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  deleteOwnReview,
  findOwnReview,
  saveDraft,
  submitDraft,
  type ReviewContent,
} from '@/lib/reviews/authoring';
import {
  anonClient,
  createTestDataScope,
  jstDate,
  signInAsMember,
  type TestDataScope,
} from '@/test-support/test-data';

/**
 * 下書き・提出・編集・削除 (one-more-time #162) をローカルの実 DB で確かめる。
 * 状態と論理削除はサーバー (service role) が書き、内容の変更は投稿者の RLS のクライアントで書く。
 */
const EMPTY: ReviewContent = {
  rating: null,
  visitedOn: null,
  attendance: null,
  foodCostBand: null,
  goodsCostBand: null,
  body: null,
  hasSpoiler: false,
};

describe('下書き・提出・編集・削除', () => {
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

  async function counts(occurrenceId: number) {
    const { data: row, error } = await data.admin
      .from('occurrences')
      .select('rating_sum, rating_count')
      .eq('id', occurrenceId)
      .single();
    if (error) throw error;
    return row;
  }

  it('下書きは星・訪問日が空でも保存でき、審査に回らず、他人には見えない', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();

    const outcome = await saveDraft(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      content: EMPTY,
    });

    expect(outcome.kind).toBe('saved');
    expect(await findOwnReview(data.admin, member.userId, occ.id)).toMatchObject({
      status: 'draft',
      rating: null,
    });
    const { data: anonRows } = await anonClient()
      .from('reviews')
      .select('id')
      .eq('occurrence_id', occ.id);
    expect(anonRows).toHaveLength(0);
    const other = await signInAsMember(await data.createMember());
    const { data: otherRows } = await other
      .from('reviews')
      .select('id')
      .eq('occurrence_id', occ.id);
    expect(otherRows).toHaveLength(0);
  });

  it('同じ下書きを別の端末から続けて書ける (同じ行を書き換える)', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const first = await saveDraft(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      content: EMPTY,
    });

    const second = await saveDraft(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      content: { ...EMPTY, rating: 4, body: '続きを書いた' },
    });

    expect(second).toEqual(first);
    expect(await findOwnReview(data.admin, member.userId, occ.id)).toMatchObject({
      rating: 4,
      body: '続きを書いた',
    });
  });

  it('下書きを提出すると審査中になる。提出の後は下書きとして保存できない', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const draft = await saveDraft(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      content: EMPTY,
    });
    if (draft.kind !== 'saved') throw new Error('draft');

    const submitted = await submitDraft(data.admin, {
      profileId: member.userId,
      reviewId: draft.reviewId,
      content: { ...EMPTY, rating: 5, visitedOn: jstDate(-1) },
    });

    expect(submitted).toBe(true);
    expect(await findOwnReview(data.admin, member.userId, occ.id)).toMatchObject({
      status: 'pending',
    });
    await expect(
      saveDraft(data.admin, { profileId: member.userId, occurrenceId: occ.id, content: EMPTY })
    ).resolves.toEqual({ kind: 'not_draft' });
  });

  it('提出の時も、訪問日の範囲を DB が確かめる (下書きの間に範囲を外れた場合)', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const draft = await saveDraft(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      content: EMPTY,
    });
    if (draft.kind !== 'saved') throw new Error('draft');
    // 範囲外の訪問日を下書きに直接入れる (サーバーの検証をすり抜けた場合の守り)
    await data.admin
      .from('reviews')
      .update({ rating: 3, visited_on: jstDate(5) })
      .eq('id', draft.reviewId);

    await expect(
      submitDraft(data.admin, {
        profileId: member.userId,
        reviewId: draft.reviewId,
        content: { ...EMPTY, rating: 3, visitedOn: jstDate(5) },
      })
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('公開中の口コミの内容を変えると審査中に戻り、集計から外れ、最終編集日が入る', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const client = await signInAsMember(member);
    const { data: inserted, error } = await client
      .from('reviews')
      .insert({
        occurrence_id: occ.id,
        user_id: member.userId,
        rating: 4,
        visited_on: jstDate(-1),
        body: '最初の本文',
      })
      .select('id')
      .single();
    if (error) throw error;
    await data.admin.from('reviews').update({ status: 'published' }).eq('id', inserted.id);
    expect(await counts(occ.id)).toMatchObject({ rating_count: 1 });

    const { error: editError } = await client
      .from('reviews')
      .update({ body: '直した本文' })
      .eq('id', inserted.id);

    expect(editError).toBeNull();
    const { data: row } = await data.admin
      .from('reviews')
      .select('status, edited_at')
      .eq('id', inserted.id)
      .single();
    expect(row).toMatchObject({ status: 'pending' });
    expect(row?.edited_at).not.toBeNull();
    expect(await counts(occ.id)).toMatchObject({ rating_count: 0 });
  });

  it('削除は論理削除で、集計から外れ、同じ開催にもう一度書ける', async () => {
    const occ = await ongoingOccurrence();
    const member = await data.createMember();
    const client = await signInAsMember(member);
    const { data: inserted, error } = await client
      .from('reviews')
      .insert({ occurrence_id: occ.id, user_id: member.userId, rating: 2, visited_on: jstDate(-1) })
      .select('id')
      .single();
    if (error) throw error;
    await data.admin.from('reviews').update({ status: 'published' }).eq('id', inserted.id);

    const outcome = await deleteOwnReview(data.admin, {
      profileId: member.userId,
      occurrenceId: occ.id,
      reviewId: inserted.id,
    });

    expect(outcome).toEqual({ kind: 'deleted', wasPublished: true });
    expect(await counts(occ.id)).toMatchObject({ rating_count: 0, rating_sum: 0 });
    const { data: deleted } = await data.admin
      .from('reviews')
      .select('deleted_at')
      .eq('id', inserted.id)
      .single();
    expect(deleted?.deleted_at).not.toBeNull();
    const again = await client.from('reviews').insert({
      occurrence_id: occ.id,
      user_id: member.userId,
      rating: 5,
      visited_on: jstDate(-1),
    });
    expect(again.error).toBeNull();
  });

  it('他人の口コミ・別の開催の口コミは削除できない', async () => {
    const occ = await ongoingOccurrence();
    const owner = await data.createMember();
    const draft = await saveDraft(data.admin, {
      profileId: owner.userId,
      occurrenceId: occ.id,
      content: EMPTY,
    });
    if (draft.kind !== 'saved') throw new Error('draft');
    const someone = await data.createMember();

    await expect(
      deleteOwnReview(data.admin, {
        profileId: someone.userId,
        occurrenceId: occ.id,
        reviewId: draft.reviewId,
      })
    ).resolves.toEqual({ kind: 'not_found' });
    // 本人でも、別の開催を名乗っては消せない
    const other = await ongoingOccurrence();
    await expect(
      deleteOwnReview(data.admin, {
        profileId: owner.userId,
        occurrenceId: other.id,
        reviewId: draft.reviewId,
      })
    ).resolves.toEqual({ kind: 'not_found' });
  });
});
