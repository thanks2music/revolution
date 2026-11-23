import { describe, expect, it } from '@jest/globals';

import { isAdminClaims } from '@/lib/auth/claims';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { isNoticeKind, noticeMessage } from '@/lib/moderation/notice';

describe('isAdminClaims', () => {
  it('app_metadata.role が admin の時だけ通す', () => {
    expect(isAdminClaims({ app_metadata: { role: 'admin' } })).toBe(true);
    expect(isAdminClaims({ app_metadata: { role: 'member' } })).toBe(false);
    expect(isAdminClaims({ app_metadata: {} })).toBe(false);
    expect(isAdminClaims(null)).toBe(false);
  });

  it('本人が書き換えられる user_metadata の印は見ない', () => {
    expect(isAdminClaims({ user_metadata: { role: 'admin' } })).toBe(false);
  });
});

describe('sanitizeNextPath (管理アプリの既定は一覧 /)', () => {
  it.each([
    ['/reviews/12', '/reviews/12'],
    ['/reviews/12?x=1#a', '/reviews/12?x=1#a'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example/', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['%2F%2Fevil.example', '/'],
    ['%E0%A4%A', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(sanitizeNextPath(raw)).toBe(expected);
  });
});

describe('isNoticeKind / noticeMessage', () => {
  it('知っている種類だけを通す (prototype のキーも通さない)', () => {
    expect(isNoticeKind('published')).toBe(true);
    expect(isNoticeKind('requeued')).toBe(true);
    expect(isNoticeKind('toString')).toBe(false);
    expect(isNoticeKind(undefined)).toBe(false);
  });

  it('知らせの文に名前を入れる', () => {
    expect(noticeMessage('rejected', 'テスト企画')).toBe('テスト企画 を差し戻しました');
  });
});
