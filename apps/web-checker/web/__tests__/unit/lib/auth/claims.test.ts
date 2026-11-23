/**
 * 使ってよいかの判定。rules と同じく、`admin` か `allowedEditor` が真偽値の true の時だけ通す。
 */

import { canUseWebChecker } from '@/lib/auth/claims';

describe('canUseWebChecker', () => {
  it.each([
    ['admin', { admin: true }],
    ['allowedEditor', { allowedEditor: true }],
    ['both', { admin: true, allowedEditor: true }],
  ])('allows a user with %s', (_label, claims) => {
    expect(canUseWebChecker(claims)).toBe(true);
  });

  it.each([
    ['no claims', {}],
    ['a string "true"', { admin: 'true' }],
    ['the number 1', { allowedEditor: 1 }],
    ['false', { admin: false, allowedEditor: false }],
    ['the retired approved claim', { approved: true }],
  ])('rejects %s', (_label, claims) => {
    expect(canUseWebChecker(claims)).toBe(false);
  });
});
