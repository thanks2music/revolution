/**
 * 読んだドキュメントの直し方。欠けた値や型の違う値で一覧ごと落ちないよう、既定値か null に倒す。
 */

import { DEFAULT_CRON, toSnapshot, toTarget } from '@/lib/firestore/mappers';

const complete = {
  url: 'https://example.com',
  selector: '#content',
  title: 'サンプル公式サイト',
  cron: '0 9 * * *',
  notifyMode: 'ai-writer',
  checkedAt: 1_700_000_000_000,
  createdAt: 1_600_000_000_000,
  createdBy: 'uid-1',
  updatedAt: 1_650_000_000_000,
  updatedBy: 'uid-2',
};

describe('toTarget', () => {
  it('passes a fully populated document through unchanged', () => {
    expect(toTarget('target-1', complete)).toEqual({ id: 'target-1', ...complete });
  });

  it('treats a missing or unknown notifyMode as Slack only', () => {
    expect(toTarget('t', { ...complete, notifyMode: undefined }).notifyMode).toBe('slack');
    expect(toTarget('t', { ...complete, notifyMode: 'email' }).notifyMode).toBe('slack');
  });

  it('falls back to the default cron when cron is missing or empty', () => {
    // Functions も同じ既定に倒すので、表示と動きがそろう
    expect(toTarget('t', { ...complete, cron: undefined }).cron).toBe(DEFAULT_CRON);
    expect(toTarget('t', { ...complete, cron: '' }).cron).toBe(DEFAULT_CRON);
  });

  it('returns null for missing optional fields instead of throwing', () => {
    const result = toTarget('t', {
      ...complete,
      checkedAt: undefined,
      updatedAt: undefined,
      updatedBy: undefined,
    });

    expect(result.checkedAt).toBeNull();
    expect(result.updatedAt).toBeNull();
    expect(result.updatedBy).toBeNull();
  });

  it('converts a Timestamp-shaped value to epoch milliseconds', () => {
    // serverTimestamp() が書かれていた場合の保険
    const timestampLike = { toMillis: () => 1_650_000_000_000 };
    expect(toTarget('t', { ...complete, checkedAt: timestampLike }).checkedAt).toBe(
      1_650_000_000_000
    );
  });

  it('returns null for an unparseable timestamp rather than NaN', () => {
    expect(toTarget('t', { ...complete, checkedAt: 'yesterday' }).checkedAt).toBeNull();
    expect(toTarget('t', { ...complete, checkedAt: Number.NaN }).checkedAt).toBeNull();
  });

  it('ignores the retired fields of the old data model', () => {
    // 旧の uri / schedule / slack / createdUser は読まない
    const result = toTarget('t', {
      uri: 'https://example.com',
      schedule: '0 9 * * *',
      slack: '#x',
      createdUser: 'u',
    });

    expect(result.url).toBe('');
    expect(result.cron).toBe(DEFAULT_CRON);
    expect(result.createdBy).toBeNull();
    expect(result).not.toHaveProperty('slack');
  });

  it('survives a completely empty document', () => {
    const result = toTarget('t', {});
    expect(result.title).toBe('');
    expect(result.cron).toBe(DEFAULT_CRON);
    expect(result.createdAt).toBeNull();
  });
});

describe('toSnapshot', () => {
  it('maps content and time', () => {
    expect(toSnapshot('snapshot-1', { content: '<p>x</p>', time: 1_700_000_000_000 })).toEqual({
      id: 'snapshot-1',
      content: '<p>x</p>',
      time: 1_700_000_000_000,
    });
  });

  it('falls back to epoch 0 for a broken time instead of throwing', () => {
    expect(toSnapshot('snapshot-1', { content: 'x', time: undefined }).time).toBe(0);
  });
});
