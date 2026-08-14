import { describe, expect, it, jest } from '@jest/globals';

import { fetchAllRows } from '@/lib/supabase/paginate';

/**
 * `fetchAllRows` の境界テスト (Layer 1 に近い純粋ロジック)。
 *
 * この関数の存在理由は「PostgREST が `db.max_rows` で**エラーなしに**打ち切るため、
 * 全件列挙が黙って先頭 N 件になる」のを防ぐこと。よって off-by-one で 1 ページ
 * 取りこぼす / 無限ループする、といった失敗を優先して固定する。
 *
 * ページサイズは実装の内部定数 (500) なので、テストからは
 * **「返却数がページサイズ未満になったら終端」という契約**を通して確認する。
 */

/** n 件のダミー行を返すページを作る。 */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe('fetchAllRows', () => {
  it('returns an empty array when the first page is empty', async () => {
    const fetchPage = jest.fn(async () => ({ data: [], error: null }));
    await expect(fetchAllRows({ label: 'x', fetchPage })).resolves.toEqual([]);
    // 空なら 1 回で終わる (無駄な 2 ページ目を引かない)。
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('returns a single short page without asking for another', async () => {
    const fetchPage = jest.fn(async () => ({ data: rows(3), error: null }));
    await expect(fetchAllRows({ label: 'x', fetchPage })).resolves.toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('asks for the next page when a page comes back exactly full', async () => {
    // ★ off-by-one の本命。ページがちょうど満杯なら**まだ続きがあるかもしれない**ので
    //   次を引く必要がある。ここで止めると 1 ページ分を黙って取りこぼす。
    let call = 0;
    const fetchPage = jest.fn(async (from: number, to: number) => {
      call += 1;
      const size = to - from + 1;
      return { data: call === 1 ? rows(size) : rows(2), error: null };
    });

    const result = await fetchAllRows({ label: 'x', fetchPage });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    // 1 ページ目 (満杯) + 2 ページ目 (2 件)
    expect(result.length).toBeGreaterThan(2);
  });

  it('advances the range window without overlapping or skipping', async () => {
    const ranges: [number, number][] = [];
    let call = 0;
    const fetchPage = jest.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      call += 1;
      const size = to - from + 1;
      return { data: call <= 2 ? rows(size) : [], error: null };
    });

    await fetchAllRows({ label: 'x', fetchPage });

    // 各ページは閉区間 [from, to]。次ページの from は前ページの to + 1 でなければ
    // 行が重複 (< ) または欠落 (> ) する。
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
    }
    // 1 ページ目は 0 から始まる。
    expect(ranges[0][0]).toBe(0);
  });

  it('throws on a query error instead of returning a partial result', async () => {
    // 部分結果を返すと「0 件」と「失敗」が区別できなくなる。
    const fetchPage = jest.fn(async () => ({ data: null, error: { message: 'boom' } }));
    await expect(fetchAllRows({ label: 'occurrence params', fetchPage })).rejects.toThrow(
      /occurrence params.*boom/s,
    );
  });

  it('reports the page number in the error message', async () => {
    let call = 0;
    const fetchPage = jest.fn(async (from: number, to: number) => {
      call += 1;
      if (call === 1) return { data: rows(to - from + 1), error: null };
      return { data: null, error: { message: 'later failure' } };
    });

    // どのページで落ちたかが分からないと再現できない。
    await expect(fetchAllRows({ label: 'x', fetchPage })).rejects.toThrow(/page 1/);
  });

  it('throws instead of silently truncating when the page cap is exceeded', async () => {
    // 常に満杯を返し続けるサーバ。切り詰めて返すと静的生成から無言で漏れる。
    const fetchPage = jest.fn(async (from: number, to: number) => ({
      data: rows(to - from + 1),
      error: null,
    }));

    await expect(fetchAllRows({ label: 'x', fetchPage })).rejects.toThrow(/exceeded/);
  });
});
