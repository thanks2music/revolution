/**
 * targetId の検証。Slack の通知のリンク (`/detail?targetId=...`) から外の値として渡り、
 * そのまま Firestore のパスに使うので、`/` を含む値を通すとサブコレクションのパスが壊れる。
 */

import { isValidTargetId } from '@/lib/target/target-id';

describe('isValidTargetId', () => {
  it('accepts an id shaped like a Firestore auto id', () => {
    // 20 文字の英数字 (ダミー)
    expect(isValidTargetId('abcdEFGH1234ijklMNOP')).toBe(true);
  });

  it.each([
    ['hyphens', 'target-1'],
    ['underscores', 'target_1'],
    ['a single character', 'a'],
  ])('accepts an id with %s', (_label, value) => {
    expect(isValidTargetId(value)).toBe(true);
  });

  it('rejects a path separator, which would break the subcollection path', () => {
    expect(isValidTargetId('a/b')).toBe(false);
    expect(isValidTargetId('../other')).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidTargetId(value)).toBe(false);
  });

  it('rejects an id longer than the Firestore limit', () => {
    expect(isValidTargetId('a'.repeat(1501))).toBe(false);
    expect(isValidTargetId('a'.repeat(1500))).toBe(true);
  });

  it('rejects characters outside the allowed set', () => {
    expect(isValidTargetId('id with space')).toBe(false);
    expect(isValidTargetId('id<script>')).toBe(false);
  });
});
