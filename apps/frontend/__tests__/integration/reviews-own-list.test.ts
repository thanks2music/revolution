import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { listOwnReviews } from '@/lib/reviews/own-reviews';
import { createTestDataScope, jstDate, type TestDataScope } from '@/test-support/test-data';

/** #12 マイページの「自分の口コミ」(one-more-time #162) をローカルの実 DB で確かめる */
describe('自分の口コミの一覧', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data.cleanup();
  });

  async function occurrence() {
    const event = await data.createEvent();
    const occ = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    return { event, occ };
  }

  it('状態と理由と開催への道筋を、本人の口コミだけ返す。削除した口コミは出さない', async () => {
    const member = await data.createMember();
    const someone = await data.createMember();
    const a = await occurrence();
    const b = await occurrence();
    const c = await occurrence();

    const insert = async (occurrenceId: number, userId: string, extra: object) => {
      const { data: row, error } = await data.admin
        .from('reviews')
        .insert({ occurrence_id: occurrenceId, user_id: userId, ...extra })
        .select('id')
        .single();
      if (error) throw error;
      return row.id as number;
    };
    await insert(a.occ.id, member.userId, { status: 'draft' });
    const rejected = await insert(b.occ.id, member.userId, {
      status: 'rejected',
      rating: 2,
      visited_on: jstDate(-1),
      reason_code: 'resale',
      reason_note: '譲渡の呼びかけの部分を直してください',
    });
    const deleted = await insert(c.occ.id, member.userId, {
      status: 'published',
      rating: 5,
      visited_on: jstDate(-1),
    });
    await data.admin
      .from('reviews')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deleted);
    await insert(a.occ.id, someone.userId, {
      status: 'published',
      rating: 3,
      visited_on: jstDate(-1),
    });

    const list = await listOwnReviews(data.admin, member.userId);

    expect(list.map(item => item.status).sort()).toEqual(['draft', 'rejected']);
    expect(list.every(item => item.canEdit)).toBe(true);
    expect(list.find(item => item.id === rejected)).toMatchObject({
      reasonCode: 'resale',
      reasonNote: '譲渡の呼びかけの部分を直してください',
      visitedOn: jstDate(-1),
      eventName: expect.stringContaining('テスト企画'),
      route: {
        eventId: String(b.event.id),
        eventType: b.event.categorySlug,
        occurrenceSlug: b.occ.slug,
      },
    });
  });

  it('公開をやめた開催の口コミは出さない。中止の開催の下書きは削除だけにする', async () => {
    const member = await data.createMember();
    const event = await data.createEvent();
    const hiddenOcc = await data.createOccurrence({
      eventId: event.id,
      verified: false,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const cancelledOcc = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const { error } = await data.admin.from('reviews').insert([
      { occurrence_id: hiddenOcc.id, user_id: member.userId, status: 'draft' },
      { occurrence_id: cancelledOcc.id, user_id: member.userId, status: 'draft' },
    ]);
    if (error) throw error;
    // 下書きを書いた後に中止になった (中止の開催には下書きも作れない)
    await data.admin
      .from('occurrences')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', cancelledOcc.id);

    const list = await listOwnReviews(data.admin, member.userId);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: 'draft',
      canEdit: false,
      route: { occurrenceSlug: cancelledOcc.slug },
    });
  });
});
