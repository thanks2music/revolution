import { describe, expect, it } from '@jest/globals';

import { articlePublishedDate, articleYear, isEndedWhenPublished, isEventEnded } from '@/lib/utils/article-date';

describe('articleYear', () => {
  it('開始日が分かれば、開始日の年 (過去もこれからも)', () => {
    expect(articleYear('2023-08-04', 2026)).toBe(2023);
    expect(articleYear('2027-01-10', 2026)).toBe(2027);
  });

  it('開始日が無い・読めなければ、渡した年', () => {
    expect(articleYear(undefined, 2026)).toBe(2026);
    expect(articleYear('8月4日', 2026)).toBe(2026);
  });
});

describe('articlePublishedDate', () => {
  const now = new Date('2026-11-25T03:00:00+09:00');
  const ran = '2026-11-24T18:00:00.000Z';

  it('終わったイベントは、開始日の日本時間 0 時', () => {
    expect(articlePublishedDate({ start: '2023-08-04', end: '2023-08-30' }, ran, now)).toBe('2023-08-03T15:00:00.000Z');
  });

  it('開催中・これからのイベントは、実行した日時のまま (終了日が今日 (日本時間) なら開催中)', () => {
    expect(articlePublishedDate({ start: '2026-11-01', end: '2026-11-25' }, ran, now)).toBe(ran);
    expect(articlePublishedDate({ start: '2026-12-02', end: '2026-12-17' }, ran, now)).toBe(ran);
  });

  it('終了日が分からない・開始日が無いときは、実行した日時のまま', () => {
    expect(articlePublishedDate({ start: '2023-08-04' }, ran, now)).toBe(ran);
    expect(articlePublishedDate({ end: '2023-08-30' }, ran, now)).toBe(ran);
  });
});

describe('isEventEnded', () => {
  // 日本時間では 11 月 25 日 (UTC ではまだ 24 日)
  const now = new Date('2026-11-25T03:00:00+09:00');

  it('終了日が実行した日 (日本時間) より前なら終わっている', () => {
    expect(isEventEnded('2023-08-30', now)).toBe(true);
    expect(isEventEnded('2026-11-24', now)).toBe(true);
  });

  it('終了日が今日 (日本時間) かそれより後なら終わっていない', () => {
    expect(isEventEnded('2026-11-25', now)).toBe(false);
    expect(isEventEnded('2026-12-17', now)).toBe(false);
  });

  it('終了日が無い・読めなければ終わっていない', () => {
    expect(isEventEnded(undefined, now)).toBe(false);
    expect(isEventEnded('8月30日', now)).toBe(false);
  });
});

describe('isEndedWhenPublished', () => {
  it('公開日が日本時間のちょうど 0 時で、終了日があれば true', () => {
    expect(isEndedWhenPublished({ date: '2023-08-03T15:00:00.000Z', event_end_date: '2023-08-30' })).toBe(true);
  });

  it('記事の更新で開始日が作り直されて動いても、公開日で見分ける', () => {
    expect(isEndedWhenPublished({ date: '2023-08-03T15:00:00.000Z', event_end_date: '2023-09-10' })).toBe(true);
  });

  it('公開日が実行した日時 (0 時ちょうどでない) なら false。1 ミリ秒ずれても false', () => {
    expect(isEndedWhenPublished({ date: '2026-11-24T18:00:00.000Z', event_end_date: '2026-12-17' })).toBe(false);
    expect(isEndedWhenPublished({ date: '2023-08-03T15:00:00.001Z', event_end_date: '2023-08-30' })).toBe(false);
  });

  it('終了日・公開日が無い、公開日が読めなければ false', () => {
    expect(isEndedWhenPublished({ date: '2023-08-03T15:00:00.000Z' })).toBe(false);
    expect(isEndedWhenPublished({ event_end_date: '2023-08-30' })).toBe(false);
    expect(isEndedWhenPublished({ date: 'not-a-date', event_end_date: '2023-08-30' })).toBe(false);
  });
});
