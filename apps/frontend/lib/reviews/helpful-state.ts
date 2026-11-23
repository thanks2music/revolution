/**
 * 開催のページの口コミについての、閲覧者の状態 (`getHelpfulState` が返す)。
 * Server Action のファイルは async 関数しか export できないので、型と空の値はここに置く
 */

/**
 * member = 押せる / login・onboarding = 押すとそこへ案内する /
 * unknown = 読めなかった (押させて、setHelpful の結果で決める。ログイン済みの会員をログインへ送らないため)
 */
export type Viewer = 'member' | 'login' | 'onboarding' | 'unknown';

/** marked = 押した口コミ、own = 本人の口コミ (通報の「…」を出さない。one-more-time #168)。どちらも渡した中から */
export type HelpfulState = { viewer: Viewer; marked: number[]; own: number[] };

export function emptyHelpfulState(viewer: Viewer): HelpfulState {
  return { viewer, marked: [], own: [] };
}
