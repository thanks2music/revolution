import { parseIdList } from '@/lib/validation/id-list';

describe('parseIdList', () => {
  it('先頭の max 件だけを読み、正の整数の一覧でなければ空にする', () => {
    expect(parseIdList([3, 1, 2], 2)).toEqual([3, 1]);
    expect(parseIdList([1, -1], 5)).toEqual([]);
    expect(parseIdList(null, 5)).toEqual([]);
    expect(parseIdList({ length: 3 }, 5)).toEqual([]);
  });
});
