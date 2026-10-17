import { formatJstDate } from '@/lib/date';

describe('formatJstDate', () => {
  it('UTC の夜 (日本時間の朝) は日本時間の日付で出す', () => {
    expect(formatJstDate('2026-10-12T21:26:06.709Z')).toBe('2026年10月13日');
  });
  it('記事カード用の数字の形', () => {
    expect(formatJstDate('2026-10-12T21:26:06.709Z', 'numeric')).toBe('2026/10/13');
  });
});
