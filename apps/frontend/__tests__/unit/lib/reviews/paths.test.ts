import { isReviewSubmitPath, isReviewWritingPath } from '@/lib/reviews/paths';

describe('口コミを書く画面のパス', () => {
  it.each([
    ['/review', true],
    ['/review?q=abc', true],
    ['/review#top', true],
    ['/collabo-cafe/12/shibuya/review', true],
    ['/collabo-cafe/12/shibuya/review/', true],
    ['/reviews', false],
    ['/mypage', false],
    ['/collabo-cafe/12/shibuya', false],
  ])('%s → %p', (path, expected) => {
    expect(isReviewWritingPath(path)).toBe(expected);
  });

  it('投稿の画面は種別・企画 ID・開催の slug の形だけ', () => {
    expect(isReviewSubmitPath('/a/1/b/review')).toBe(true);
    expect(isReviewSubmitPath('/a/b/c/review')).toBe(false);
  });
});
