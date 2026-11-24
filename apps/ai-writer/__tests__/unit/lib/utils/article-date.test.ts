import { describe, expect, it } from '@jest/globals';

import { articlePublishedDate, articleYear } from '@/lib/utils/article-date';

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
