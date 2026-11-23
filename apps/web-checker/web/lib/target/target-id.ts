/**
 * `?targetId=` の検証。Slack の通知のリンクから外の値として渡ってきて、そのまま Firestore のパスに使う。
 *
 * Firestore の自動 ID は 20 文字の英数字。手で付けた ID のために `-` と `_` も通す。上限は Firestore の
 * ドキュメント ID の上限 (1500 バイト)。`/` を通すとサブコレクションのパスが壊れるので、文字の種類を限る。
 */
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,1500}$/;

export function isValidTargetId(value: string | null | undefined): value is string {
  return typeof value === 'string' && TARGET_ID_PATTERN.test(value);
}
