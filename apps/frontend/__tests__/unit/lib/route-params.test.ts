import { describe, expect, it } from '@jest/globals';

import { parseCanonicalId } from '@/lib/route-params';

/**
 * ★ PR #303 レビュー指摘の回帰テスト。
 *
 * 旧実装は `Number(raw)` + `Number.isInteger` で判定していたため、
 * **8 通りの表記がすべて同じ ID に解決**していた (2026-08-14 実測)。
 * `/events/2` と `/events/2.0` と `/events/0x2` が同一コンテンツを 200 で返し、
 * canonical も出していなかったので重複コンテンツを無限に作れる状態だった。
 */
describe('parseCanonicalId', () => {
  it('accepts the canonical form', () => {
    expect(parseCanonicalId('1')).toBe(1);
    expect(parseCanonicalId('2')).toBe(2);
    expect(parseCanonicalId('1234567')).toBe(1234567);
  });

  it.each([
    ['小数点付き', '2.0'],
    ['末尾ピリオド', '2.'],
    ['指数表記', '2e0'],
    ['16 進', '0x2'],
    ['符号付き', '+2'],
    ['先頭ゼロ', '02'],
    ['前後の空白', ' 2 '],
    ['全角数字', '２'],
  ])('rejects the non-canonical form (%s): %p', (_label, raw) => {
    // これらは旧実装ではすべて 2 に解決していた。
    expect(parseCanonicalId(raw)).toBeNull();
  });

  it.each([
    ['ゼロ', '0'],
    ['負数', '-1'],
    ['空文字', ''],
    ['非数値', 'abc'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['カンマ区切り', '1,000'],
    ['パス片', '2/3'],
  ])('rejects invalid input (%s): %p', (_label, raw) => {
    expect(parseCanonicalId(raw)).toBeNull();
  });

  it('rejects values beyond safe integer precision', () => {
    // bigint 主キーなので理屈上到達しうる。精度が落ちた値で DB を引かない。
    expect(parseCanonicalId('9007199254740993')).toBeNull();
  });
});
