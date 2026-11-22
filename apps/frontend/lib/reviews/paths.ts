/**
 * 口コミを書く画面のパス (one-more-time #161・#166)。middleware の保護と、ログインの画面の案内が使う。
 */

/** 口コミを書く開催を選ぶ (7-0) */
export const REVIEW_PICKER_PATH = '/review';

/** 口コミの投稿 `/{種別}/{企画 ID}/{開催の slug}/review`。前方一致では書けないので形で見る */
const REVIEW_SUBMIT_PATH = /^\/[^/]+\/\d+\/[^/]+\/review\/?$/;

export function isReviewSubmitPath(pathname: string): boolean {
  return REVIEW_SUBMIT_PATH.test(pathname);
}

/** 口コミを書くために来た画面か (7-0 か投稿の画面。クエリは見ない) */
export function isReviewWritingPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return pathname === REVIEW_PICKER_PATH || isReviewSubmitPath(pathname);
}
