/**
 * @jest-environment node
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type postgres from 'postgres';

import { localSql } from '@/test-support/local-supabase';
import {
  anonClient,
  createTestDataScope,
  signInAsMember,
  type TestDataScope,
} from '@/test-support/test-data';

/**
 * 口コミの通報 (one-more-time #168、migration 0028)。本物の Postgres に対して、公開サイトのサーバーと同じく
 * service role で submit_review_report を呼ぶ。
 *
 * 通報の表は関数からしか読み書きできない (service role にも渡していない) ので、中身はローカルの DB に
 * 直接つないで確かめる (localSql はローカルの DB でなければ断る)
 */
describe('口コミの通報', () => {
  let data: TestDataScope;
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = localSql();
  });
  afterAll(async () => {
    await sql.end();
  });
  beforeEach(() => {
    data = createTestDataScope();
  });
  afterEach(async () => {
    await data.cleanup();
  });

  const review = (status: 'published' | 'pending' = 'published') => data.createReview({ status });

  function submit(
    reviewId: number,
    reporter: { profileId?: string; deviceId?: string },
    reason = 'spam',
    db: SupabaseClient = data.admin
  ) {
    return db.rpc('submit_review_report', {
      p_review_id: reviewId,
      p_reason_code: reason,
      p_reporter_profile_id: reporter.profileId ?? null,
      p_reporter_device_id: reporter.deviceId ?? null,
    });
  }

  async function reports(reviewId: number) {
    return sql<
      {
        reason_code: string;
        reporter_profile_id: string | null;
        reporter_device_id: string | null;
        status: string;
      }[]
    >`SELECT reason_code, reporter_profile_id, reporter_device_id, status
      FROM public.review_reports WHERE review_id = ${reviewId} ORDER BY id`;
  }

  it('未ログイン (端末) の通報を受け付け、IP などは持たない', async () => {
    const { reviewId } = await review();
    const deviceId = randomUUID();

    const { data: result, error } = await submit(reviewId, { deviceId }, 'resale');

    expect(error).toBeNull();
    expect(result).toBe('accepted');
    expect(await reports(reviewId)).toEqual([
      {
        reason_code: 'resale',
        reporter_profile_id: null,
        reporter_device_id: deviceId,
        status: 'open',
      },
    ]);
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'review_reports'`;
    expect(columns.map(column => column.column_name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/ip|agent/)])
    );
  });

  it('同じ端末・同じ会員からの未処理の通報は 1 件にまとまる (理由を変えても)', async () => {
    const { reviewId } = await review();
    const deviceId = randomUUID();
    const member = await data.createMember();

    for (const reason of ['spam', 'abuse']) {
      expect((await submit(reviewId, { deviceId }, reason)).data).toBe('accepted');
      expect((await submit(reviewId, { profileId: member.userId }, reason)).data).toBe('accepted');
    }

    const rows = await reports(reviewId);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.reason_code)).toEqual(['spam', 'spam']);
  });

  it('別の端末・別の会員の通報は別に数える', async () => {
    const { reviewId } = await review();
    await submit(reviewId, { deviceId: randomUUID() });
    await submit(reviewId, { deviceId: randomUUID() });
    await submit(reviewId, { profileId: (await data.createMember()).userId });

    expect(await reports(reviewId)).toHaveLength(3);
  });

  it('処理済みの後は、同じ人がもう一度通報できる', async () => {
    const { reviewId } = await review();
    const deviceId = randomUUID();
    await submit(reviewId, { deviceId });
    await sql`UPDATE public.review_reports
      SET status = 'handled', actions = ARRAY['dismissed'], handled_at = now(), handled_by = ${randomUUID()}
      WHERE review_id = ${reviewId}`;

    expect((await submit(reviewId, { deviceId })).data).toBe('accepted');
    expect((await reports(reviewId)).map(row => row.status)).toEqual(['handled', 'open']);
  });

  it('公開中でない口コミ・消した口コミ・無い口コミ・本人の口コミは受けない', async () => {
    const pending = await review('pending');
    const deleted = await review();
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deleted.reviewId);
    const own = await review();

    expect((await submit(pending.reviewId, { deviceId: randomUUID() })).data).toBe('not_found');
    expect((await submit(deleted.reviewId, { deviceId: randomUUID() })).data).toBe('not_found');
    expect((await submit(2_000_000_000, { deviceId: randomUUID() })).data).toBe('not_found');
    expect((await submit(own.reviewId, { profileId: own.author.userId })).data).toBe('not_found');
    for (const reviewId of [pending.reviewId, deleted.reviewId, own.reviewId]) {
      expect(await reports(reviewId)).toHaveLength(0);
    }
  });

  it('通報した人は会員か端末のどちらか一方だけ。理由は 8 つのどれか', async () => {
    const { reviewId } = await review();
    const member = await data.createMember();

    expect((await submit(reviewId, {})).error?.code).toBe('22023');
    expect(
      (await submit(reviewId, { profileId: member.userId, deviceId: randomUUID() })).error?.code
    ).toBe('22023');
    expect((await submit(reviewId, { deviceId: randomUUID() }, 'ai_failure')).error?.code).toBe(
      '23514'
    );
    expect((await submit(reviewId, { deviceId: randomUUID() }, 'not_attended')).data).toBe(
      'accepted'
    );
  });

  it('anon と会員は、通報の表も関数も使えない (書き込みは公開サイトのサーバー経由だけ)', async () => {
    const { reviewId } = await review();
    const member = await data.createMember();
    for (const db of [anonClient(), await signInAsMember(member)]) {
      const rpc = await submit(reviewId, { deviceId: randomUUID() }, 'spam', db);
      expect(rpc.error?.code).toBe('42501');
      const insert = await db
        .from('review_reports')
        .insert({ target_type: 'review', review_id: reviewId, reason_code: 'spam' });
      expect(insert.error?.code).toBe('42501');
      const select = await db.from('review_reports').select('id');
      expect(select.error?.code).toBe('42501');
    }
    expect(await reports(reviewId)).toHaveLength(0);
  });

  it('service role も表を直接は読み書きできない (関数だけを通す)', async () => {
    const { reviewId } = await review();
    const insert = await data.admin
      .from('review_reports')
      .insert({ target_type: 'review', review_id: reviewId, reason_code: 'spam' });
    expect(insert.error?.code).toBe('42501');
    expect((await data.admin.from('review_reports').select('id')).error?.code).toBe('42501');
  });

  it('口コミを消す (行ごと) と通報も消える', async () => {
    const { reviewId } = await review();
    await submit(reviewId, { deviceId: randomUUID() });
    await data.admin.from('reviews').delete().eq('id', reviewId);
    expect(await reports(reviewId)).toHaveLength(0);
  });
});
