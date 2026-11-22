jest.mock('@/lib/env', () => ({ env: {} }));

import { isPathProtected } from '@/lib/supabase/middleware';

describe('isPathProtected', () => {
  it.each([
    ['/mypage', true],
    ['/mypage/settings', true],
    ['/onboarding', true],
    ['/review', true],
    ['/reviews', false],
    ['/collabo-cafe/12/shibuya/review', true],
    ['/collabo-cafe/12/shibuya/review/', true],
    ['/collabo-cafe/12/shibuya', false],
    ['/collabo-cafe/12', false],
    ['/articles/01abc', false],
    ['/collabo-cafe/12/shibuya/reviews', false],
    ['/a/b/c/d/review', false],
    ['/venues/foo/bar/review', false],
    ['/mypages', false],
  ])('%s → %p', (pathname, expected) => {
    expect(isPathProtected(pathname)).toBe(expected);
  });
});
