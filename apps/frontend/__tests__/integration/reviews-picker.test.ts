import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { getReviewTargets, searchReviewTargets } from '@/lib/reviews/picker';
import { createTestDataScope, jstDate, type TestDataScope } from '@/test-support/test-data';

/** 口コミを書く開催を選ぶ (7-0、one-more-time #166) の検索と取得を、ローカルの実 DB で確かめる */
describe('口コミを書く開催を選ぶ', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data.cleanup();
  });

  it('企画名で探し、書ける開催を先に出す。開催前は「まだ書けない」。確認していない開催は出さない', async () => {
    const marker = `ぴっかー${Date.now()}`;
    const event = await data.createEvent({ name: `${marker} コラボカフェ` });
    const ongoing = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const scheduled = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(10),
      endsOn: jstDate(30),
    });
    await data.createOccurrence({
      eventId: event.id,
      verified: false,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });

    const targets = await searchReviewTargets(marker);

    expect(targets.map(target => [target.occurrenceId, target.canWrite])).toEqual([
      [ongoing.id, true],
      [scheduled.id, false],
    ]);
    expect(targets[0]).toMatchObject({
      eventName: `${marker} コラボカフェ`,
      status: 'ongoing',
      occurrencePath: `/${event.categorySlug}/${event.id}/${ongoing.slug}`,
    });
  });

  it('LIKE の特別な文字は、そのままの文字として探す', async () => {
    const marker = `ぴっかー${Date.now()}`;
    const event = await data.createEvent({ name: `${marker} 100% 当選` });
    await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-1),
      endsOn: jstDate(5),
    });

    await expect(searchReviewTargets(`${marker} 100%`)).resolves.toHaveLength(1);
    await expect(searchReviewTargets(`${marker} 1_0`)).resolves.toHaveLength(0);
  });

  it('開催前の開催が多くても、書ける開催が押し出されない', async () => {
    const marker = `ぴっかー${Date.now()}`;
    const event = await data.createEvent({ name: `${marker} 全国巡回` });
    for (let i = 0; i < 31; i++) {
      await data.createOccurrence({
        eventId: event.id,
        verified: true,
        startsOn: jstDate(10 + i),
        endsOn: jstDate(40 + i),
      });
    }
    const ongoing = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-3),
      endsOn: jstDate(3),
    });

    const targets = await searchReviewTargets(marker);

    expect(targets[0]).toMatchObject({ occurrenceId: ongoing.id, canWrite: true });
  });

  it('会場がマスタに無い開催は、会場の表示名で探せる。`*` で何でも当たらない', async () => {
    const marker = `かいじょう${Date.now()}`;
    const event = await data.createEvent();
    const occurrence = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-3),
      endsOn: jstDate(3),
    });
    const { error } = await data.admin
      .from('occurrences')
      .update({ venue_label: `${marker} 本店` })
      .eq('id', occurrence.id);
    if (error) throw error;

    await expect(searchReviewTargets(marker)).resolves.toEqual([
      expect.objectContaining({ occurrenceId: occurrence.id, venueName: `${marker} 本店` }),
    ]);
    await expect(searchReviewTargets(`${marker}*存在しない`)).resolves.toEqual([]);
  });

  it('ID から引く時は、渡した順に並べ、見つからない・確認していない開催は除く', async () => {
    const event = await data.createEvent();
    const a = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-5),
      endsOn: jstDate(5),
    });
    const b = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-20),
      endsOn: jstDate(-15),
    });
    const hidden = await data.createOccurrence({
      eventId: event.id,
      verified: false,
      startsOn: jstDate(-5),
      endsOn: jstDate(5),
    });

    const targets = await getReviewTargets([b.id, hidden.id, a.id, 999_999_999]);

    expect(targets.map(target => target.occurrenceId)).toEqual([b.id, a.id]);
    expect(targets[0]).toMatchObject({ status: 'ended', canWrite: true });
  });
});
