import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  anonClient,
  createTestDataScope,
  signInAsMember,
  jstDate,
  type TestDataScope,
  type TestMember,
} from '@/test-support/test-data';

/**
 * 口コミの DB (0018 の migration) をローカルの実 DB で確かめる。
 *
 * 外から見える振る舞いで書く: 提出すると審査中で他人に見えない、公開すると見えて集計に入る、
 * 投稿者は状態を書けない、など。審査の結果の書き込みはサーバー (service role) の役目なので、
 * テストでは admin のクライアントで行う。
 */
type Occ = { id: number };

describe('口コミの DB', () => {
  let data: TestDataScope | undefined;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data?.cleanup();
  });

  /** 開催中 (10 日前から 20 日後まで) の承認済みの開催 */
  async function ongoingOccurrence(): Promise<Occ> {
    const event = await data!.createEvent();
    return data!.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
  }

  /** 会員として口コミを提出し、後片付けに登録する */
  async function submit(
    client: SupabaseClient,
    member: TestMember,
    occurrenceId: number,
    fields: Record<string, unknown> = {},
  ) {
    const result = await client
      .from('reviews')
      .insert({
        occurrence_id: occurrenceId,
        user_id: member.userId,
        rating: 4,
        visited_on: jstDate(-1),
        body: '平日の夕方に予約なしで入れました',
        ...fields,
      })
      .select('id')
      .single();
    return result;
  }

  /** サーバー (service role) として審査の結果などを書く。準備の失敗は、ここで原因のエラーのまま落とす */
  async function setReview(id: number, fields: Record<string, unknown>) {
    const { error } = await data!.admin.from('reviews').update(fields).eq('id', id);
    if (error) throw error;
  }

  /** 削除はサーバー (service role) が行う (投稿者には deleted_at の UPDATE を許していない) */
  async function softDelete(id: number) {
    await setReview(id, { deleted_at: new Date().toISOString() });
  }

  async function adminReview(id: number) {
    const { data: row, error } = await data!.admin.from('reviews').select('*').eq('id', id).single();
    if (error) throw error;
    return row as Record<string, unknown>;
  }

  async function occurrenceRating(id: number) {
    const { data: row } = await data!.admin
      .from('occurrences')
      .select('rating_sum, rating_count')
      .eq('id', id)
      .single();
    return row as { rating_sum: number; rating_count: number };
  }

  describe('提出', () => {
    it('提出すると審査中になり、提出の日時が入る', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { data: row, error } = await submit(client, member, occ.id);

      expect(error).toBeNull();
      const stored = await adminReview(row!.id as number);
      expect(stored.status).toBe('pending');
      expect(stored.submitted_at).not.toBeNull();
    });

    it('投稿者が状態を「公開」にして送っても、書けずに拒否される', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { error } = await submit(client, member, occ.id, { status: 'published' });

      expect(error?.code).toBe('42501');
    });

    it('投稿者は自分の口コミの状態・理由・AI の記録を書き換えられない', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id);

      for (const fields of [{ status: 'published' }, { reason_code: 'spam' }, { ai_model: 'x' }]) {
        const { error } = await client.from('reviews').update(fields).eq('id', row!.id);
        expect(error?.code).toBe('42501');
      }
      expect((await adminReview(row!.id as number)).status).toBe('pending');
    });

    it('投稿者は deleted_at を書けない (削除はサーバーが行う)', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id);

      const { error } = await client
        .from('reviews')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', row!.id);

      expect(error?.code).toBe('42501');
    });

    it('会員は自分の公開中の口コミの件数を書き換えられない', async () => {
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { error } = await client
        .from('profiles')
        .update({ published_review_count: 1 })
        .eq('id', member.userId);

      expect(error?.code).toBe('42501');
    });

    it('1 人 1 開催 1 件。論理削除の後は書き直せる', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: first } = await submit(client, member, occ.id);

      const second = await submit(client, member, occ.id);
      expect(second.error?.code).toBe('23505');

      await softDelete(first!.id as number);
      const again = await submit(client, member, occ.id);
      expect(again.error).toBeNull();
    });

    it('2000 字を超える本文は拒否される', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { error } = await submit(client, member, occ.id, { body: 'あ'.repeat(2001) });

      expect(error?.code).toBe('23514');
    });

    it('星か訪問日が無ければ拒否される (下書き以外)', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      expect((await submit(client, member, occ.id, { rating: null })).error?.code).toBe('23514');
      expect((await submit(client, member, occ.id, { visited_on: null })).error?.code).toBe('23514');
    });
  });

  describe('開催と訪問日', () => {
    it.each([
      ['中止', { cancelled: true }],
      ['開催前', { startsOn: jstDate(3), endsOn: jstDate(30) }],
      ['日程未発表', { startsOn: null }],
    ])('%s の開催には提出できない', async (_label, occurrence) => {
      const event = await data!.createEvent();
      const occ = await data!.createOccurrence({ eventId: event.id, verified: true, ...occurrence });
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { error } = await submit(client, member, occ.id, { visited_on: jstDate() });

      expect(error?.code).toBe('23514');
    });

    it.each([
      ['開始日より前', -11],
      ['今日より後', 1],
    ])('訪問日が%sなら拒否される', async (_label, offset) => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      const { error } = await submit(client, member, occ.id, { visited_on: jstDate(offset) });

      expect(error?.code).toBe('23514');
    });

    it('終了日の後には訪問日を置けない', async () => {
      const event = await data!.createEvent();
      const occ = await data!.createOccurrence({
        eventId: event.id,
        verified: true,
        startsOn: jstDate(-30),
        endsOn: jstDate(-10),
      });
      const member = await data!.createMember();
      const client = await signInAsMember(member);

      expect((await submit(client, member, occ.id, { visited_on: jstDate(-5) })).error?.code).toBe(
        '23514',
      );
      expect((await submit(client, member, occ.id, { visited_on: jstDate(-10) })).error).toBeNull();
    });
  });

  describe('公開範囲と集計', () => {
    it('審査中の口コミは anon と他の会員には見えず、本人には見える', async () => {
      const occ = await ongoingOccurrence();
      const author = await data!.createMember();
      const other = await data!.createMember();
      const authorClient = await signInAsMember(author);
      const { data: row } = await submit(authorClient, author, occ.id);

      const asAnon = await anonClient().from('reviews').select('id').eq('id', row!.id);
      const asOther = await (await signInAsMember(other)).from('reviews').select('id').eq('id', row!.id);
      const asAuthor = await authorClient.from('reviews').select('id, status').eq('id', row!.id);

      expect(asAnon.data).toEqual([]);
      expect(asOther.data).toEqual([]);
      expect(asAuthor.data).toEqual([{ id: row!.id, status: 'pending' }]);
    });

    it('公開すると anon に見え、星の合計と件数に入る。外すと戻る', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const { data: row } = await submit(await signInAsMember(member), member, occ.id, { rating: 4 });
      expect(await occurrenceRating(occ.id)).toEqual({ rating_sum: 0, rating_count: 0 });

      await setReview(row!.id as number, { status: 'published' });

      const asAnon = await anonClient().from('reviews').select('id, rating').eq('id', row!.id);
      expect(asAnon.data).toEqual([{ id: row!.id, rating: 4 }]);
      expect(await occurrenceRating(occ.id)).toEqual({ rating_sum: 4, rating_count: 1 });

      await setReview(row!.id as number, { status: 'hidden' });
      expect(await occurrenceRating(occ.id)).toEqual({ rating_sum: 0, rating_count: 0 });
    });

    it('投稿者の公開中の件数は公開・非公開・削除で増減し、0 になると anon から表示名が見えなくなる', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const { data: row } = await submit(await signInAsMember(member), member, occ.id);
      const count = async () => {
        const { data: profile } = await data!.admin
          .from('profiles')
          .select('published_review_count')
          .eq('id', member.userId)
          .single();
        return (profile as { published_review_count: number }).published_review_count;
      };
      const visibleToAnon = async () =>
        ((await anonClient().from('profiles').select('id').eq('id', member.userId)).data ?? []).length;

      expect(await count()).toBe(0);
      await setReview(row!.id as number, { status: 'published' });
      expect([await count(), await visibleToAnon()]).toEqual([1, 1]);
      await setReview(row!.id as number, { status: 'hidden' });
      expect([await count(), await visibleToAnon()]).toEqual([0, 0]);
      await setReview(row!.id as number, { status: 'published' });
      await softDelete(row!.id as number);
      expect([await count(), await visibleToAnon()]).toEqual([0, 0]);
    });

    // 仕様 (状態の遷移の表): 非公開・BOSS の確認待ちも、投稿者が直して出し直すと審査中に戻り、もう一度 AI の審査を通る
    it.each(['hidden', 'needs_review'])('%s の口コミも、投稿者が直すと審査中に戻る', async (status) => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id);
      await setReview(row!.id as number, { status, reason_code: status === 'hidden' ? 'spam' : null });

      await client.from('reviews').update({ body: '直しました' }).eq('id', row!.id);

      expect(await adminReview(row!.id as number)).toMatchObject({ status: 'pending', reason_code: null });
    });

    it('公開中の口コミを論理削除すると集計から外れ、anon に見えなくなる', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id, { rating: 5 });
      await setReview(row!.id as number, { status: 'published' });

      await softDelete(row!.id as number);

      expect(await occurrenceRating(occ.id)).toEqual({ rating_sum: 0, rating_count: 0 });
      expect((await anonClient().from('reviews').select('id').eq('id', row!.id)).data).toEqual([]);
    });

    it('公開後に内容を変えると審査中に戻り、最終編集日が入り、集計から外れる', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id, { rating: 3 });
      await setReview(row!.id as number, { status: 'published' });

      const { error } = await client.from('reviews').update({ body: '書き直しました' }).eq('id', row!.id);

      expect(error).toBeNull();
      const stored = await adminReview(row!.id as number);
      expect(stored.status).toBe('pending');
      expect(stored.edited_at).not.toBeNull();
      expect(await occurrenceRating(occ.id)).toEqual({ rating_sum: 0, rating_count: 0 });
    });

    it('差し戻しの口コミを直すと審査中に戻り、理由が消え、最終編集日は入らない', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const { data: row } = await submit(client, member, occ.id);
      await setReview(row!.id as number, {
        status: 'rejected',
        reason_code: 'spam',
        ai_reason: '宣伝が含まれる',
        ai_model: 'test-model',
      });

      await client.from('reviews').update({ body: '宣伝の部分を消しました' }).eq('id', row!.id);

      const stored = await adminReview(row!.id as number);
      expect(stored).toMatchObject({
        status: 'pending',
        reason_code: null,
        edited_at: null,
        // 前の内容への AI の判断は消える
        ai_reason: null,
        ai_model: null,
      });
    });

    it('中止になった開催の口コミも、訪問日を同じ値で送れば本文を直せる', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const client = await signInAsMember(member);
      const visitedOn = jstDate(-1);
      const { data: row } = await submit(client, member, occ.id, { visited_on: visitedOn });
      const { error: cancelError } = await data!.admin
        .from('occurrences')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('id', occ.id);
      if (cancelError) throw cancelError;

      const { error } = await client
        .from('reviews')
        .update({ body: '誤字を直しました', visited_on: visitedOn })
        .eq('id', row!.id);

      expect(error).toBeNull();
    });

    it('anon は訪問日 (日付) を読めず、訪問年月は読める', async () => {
      const occ = await ongoingOccurrence();
      const member = await data!.createMember();
      const { data: row } = await submit(await signInAsMember(member), member, occ.id, {
        visited_on: jstDate(-1),
      });
      await setReview(row!.id as number, { status: 'published' });

      const dateRead = await anonClient().from('reviews').select('visited_on').eq('id', row!.id);
      const monthRead = await anonClient().from('reviews').select('visited_month').eq('id', row!.id);

      expect(dateRead.error?.code).toBe('42501');
      expect(monthRead.data).toEqual([{ visited_month: `${jstDate(-1).slice(0, 7)}-01` }]);
    });

    it('公開中の口コミの投稿者の表示名は anon に見え、口コミの無い会員の表示名は見えない', async () => {
      const occ = await ongoingOccurrence();
      const author = await data!.createMember();
      const stranger = await data!.createMember();
      const { data: row } = await submit(await signInAsMember(author), author, occ.id);
      await setReview(row!.id as number, { status: 'published' });

      const { data: profiles } = await anonClient()
        .from('profiles')
        .select('id, display_name')
        .in('id', [author.userId, stranger.userId]);

      expect(profiles).toEqual([{ id: author.userId, display_name: author.username }]);
    });

    it('他人の profile は表示に使う列だけが読め、それ以外の列は読めない', async () => {
      const occ = await ongoingOccurrence();
      const author = await data!.createMember();
      const viewer = await data!.createMember();
      const { data: row } = await submit(await signInAsMember(author), author, occ.id);
      await setReview(row!.id as number, { status: 'published' });
      const viewerClient = await signInAsMember(viewer);

      const shown = await viewerClient.from('profiles').select('display_name').eq('id', author.userId);
      const hidden = await viewerClient.from('profiles').select('updated_at').eq('id', author.userId);

      expect(shown.data).toEqual([{ display_name: author.username }]);
      expect(hidden.error?.code).toBe('42501');
    });
  });
});
