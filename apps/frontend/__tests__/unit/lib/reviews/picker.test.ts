import { normalizeQuery, toLikePattern } from '@/lib/reviews/picker';

jest.mock('@/lib/env', () => ({ env: {} }));

describe('normalizeQuery', () => {
  it('前後の空白を除き、空なら null、長すぎる物は 50 字で切る', () => {
    expect(normalizeQuery('  呪術  ')).toBe('呪術');
    expect(normalizeQuery('   ')).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery('あ'.repeat(60))).toHaveLength(50);
  });
});

describe('toLikePattern', () => {
  it('LIKE の特別な文字をそのままの文字にし、`*` (PostgREST の % の別名) は空白にする', () => {
    // 期待値は TS の文字列 ('\\' が 1 文字の \)
    expect(toLikePattern('100%')).toBe('%100\\%%');
    expect(toLikePattern('a_b')).toBe('%a\\_b%');
    expect(toLikePattern('a\\b')).toBe('%a\\\\b%');
    expect(toLikePattern('A*B')).toBe('%A B%');
  });
});
